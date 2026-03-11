import * as dotenv from 'dotenv';
import mongoInstance from '../../lib/mongo.js';
import { createSnapshot } from '../../lib/snapshot.js';
import { createLogger } from '../../lib/logger.js';
import { AssetComputer } from '../../schemas/specific/asset-computer.js';
import { ComputeManagementClient } from '@azure/arm-compute';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';

dotenv.config();

const logger = createLogger('azure-vms');

/**
 * Azure VMs Collector
 * 
 * Collects Azure Virtual Machine information and normalizes it to AssetComputer schema.
 * 
 * IMPORTANT: This is a stub implementation. In production, you would:
 * 1. Install @azure/arm-compute and @azure/identity
 * 2. Use proper Azure credentials (Service Principal or Managed Identity)
 * 3. Handle pagination for large VM sets
 * 4. Query across multiple subscriptions if needed
 * 5. Add error handling for API failures
 * 
 * For now, this demonstrates the collection pattern with mock data.
 */

interface AzureVM {
  id: string;
  name: string;
  location: string;
  vmSize: string;
  powerState: string;
  osType: string;
  osVersion?: string;
  privateIp?: string;
  publicIp?: string;
  resourceGroup: string;
  subscriptionId: string;
  tags: Record<string, string>;
  provisioningState: string;
}

/**
 * Fetch Azure VMs using Azure SDK
 */
async function fetchAzureVMs(): Promise<AzureVM[]> {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  
  if (!subscriptionId) {
    throw new Error('AZURE_SUBSCRIPTION_ID environment variable is required');
  }
  
  // Create credential
  let credential;
  if (process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET) {
    // Use service principal
    credential = new ClientSecretCredential(
      process.env.AZURE_TENANT_ID,
      process.env.AZURE_CLIENT_ID,
      process.env.AZURE_CLIENT_SECRET
    );
  } else {
    // Use default credential chain (Azure CLI, Managed Identity, etc.)
    credential = new DefaultAzureCredential();
  }
  
  const computeClient = new ComputeManagementClient(credential, subscriptionId);
  const vms: AzureVM[] = [];
  
  logger.info(`Querying Azure subscription: ${subscriptionId}`);
  
  // List all VMs in subscription
  for await (const vm of computeClient.virtualMachines.listAll()) {
    if (!vm.id || !vm.name) continue;
    
    // Extract resource group from resource ID
    const resourceGroupMatch = vm.id.match(/resourceGroups\/([^\/]+)/);
    const resourceGroup = resourceGroupMatch ? resourceGroupMatch[1] : 'unknown';
    
    try {
      // Get instance view for power state
      const instanceView = await computeClient.virtualMachines.instanceView(
        resourceGroup,
        vm.name
      );
      
      const powerState = instanceView.statuses?.find(s => 
        s.code?.startsWith('PowerState/')
      )?.code?.replace('PowerState/', '') || 'unknown';
      
      // Get network interfaces for IP addresses
      let privateIp: string | undefined;
      let publicIp: string | undefined;
      
      if (vm.networkProfile?.networkInterfaces && vm.networkProfile.networkInterfaces.length > 0) {
        const nicId = vm.networkProfile.networkInterfaces[0].id;
        if (nicId) {
          const nicResourceGroup = nicId.match(/resourceGroups\/([^\/]+)/)?.[1];
          const nicName = nicId.split('/').pop();
          
          if (nicResourceGroup && nicName) {
            // Note: Fetching network details requires @azure/arm-network package
            // For now, we'll skip network IP details
            // To implement: use NetworkManagementClient to get NIC details and IP addresses
          }
        }
      }
      
      vms.push({
        id: vm.id,
        name: vm.name,
        location: vm.location || 'unknown',
        vmSize: vm.hardwareProfile?.vmSize || 'unknown',
        powerState,
        osType: vm.storageProfile?.osDisk?.osType || 'unknown',
        osVersion: vm.storageProfile?.imageReference?.offer ? 
          `${vm.storageProfile.imageReference.offer} ${vm.storageProfile.imageReference.sku || ''}`.trim() : 
          undefined,
        privateIp,
        publicIp,
        resourceGroup,
        subscriptionId,
        tags: vm.tags || {},
        provisioningState: vm.provisioningState || 'unknown',
      });
    } catch (error) {
      logger.warn(`Failed to get instance view for VM ${vm.name}: ${error}`);
      // Add VM with basic info even if instance view fails
      vms.push({
        id: vm.id,
        name: vm.name,
        location: vm.location || 'unknown',
        vmSize: vm.hardwareProfile?.vmSize || 'unknown',
        powerState: 'unknown',
        osType: vm.storageProfile?.osDisk?.osType || 'unknown',
        resourceGroup,
        subscriptionId,
        tags: vm.tags || {},
        provisioningState: vm.provisioningState || 'unknown',
      });
    }
  }
  
  return vms;
}

/**
 * Transform Azure VM to AssetComputer schema
 */
function transformAzureVMToAsset(vm: AzureVM): Partial<AssetComputer> {
  // Parse VM size to extract CPU/memory (simplified mapping)
  const sizeMap: Record<string, { cpu: number; memory: number }> = {
    'Standard_B1s': { cpu: 1, memory: 1024 },
    'Standard_B2s': { cpu: 2, memory: 4096 },
    'Standard_D2s_v3': { cpu: 2, memory: 8192 },
    'Standard_D4s_v3': { cpu: 4, memory: 16384 },
    'Standard_E4s_v3': { cpu: 4, memory: 32768 },
    'Standard_E8s_v3': { cpu: 8, memory: 65536 },
  };
  
  const specs = sizeMap[vm.vmSize] || { cpu: 2, memory: 8192 };
  
  // Map power state to status
  const statusMap: Record<string, 'running' | 'stopped' | 'maintenance' | 'unknown'> = {
    'running': 'running',
    'stopped': 'stopped',
    'deallocated': 'stopped',
    'starting': 'maintenance',
    'stopping': 'maintenance',
  };
  
  // Build tag array
  const tags = Object.entries(vm.tags || {}).map(([key, value]) => `${key}:${value}`);
  
  return {
    id: vm.id,
    name: vm.name,
    type: 'computer' as const,
    discoveredAt: new Date().toISOString(),
    source: 'azure-vms',
    schemaVersion: 1,
    description: `Azure VM ${vm.vmSize} in ${vm.location}`,
    tags,
    
    location: {
      region: vm.location,
      datacenter: vm.resourceGroup,
    },
    
    ownership: vm.tags?.Owner ? {
      owner: vm.tags.Owner,
      team: vm.tags.CostCenter,
    } : undefined,
    
    // Computer-specific fields
    os: vm.osType,
    osVersion: vm.osVersion,
    cpu: specs.cpu,
    memory: specs.memory,
    
    network: [
      ...(vm.privateIp ? [{
        interface: 'eth0',
        ipAddress: vm.privateIp,
        type: 'physical' as const,
      }] : []),
      ...(vm.publicIp ? [{
        interface: 'eth0:public',
        ipAddress: vm.publicIp,
        type: 'physical' as const,
      }] : []),
    ],
    
    status: statusMap[vm.powerState.toLowerCase()] || 'unknown',
    hostname: vm.name,
    fqdn: `${vm.name}.${vm.location}.cloudapp.azure.com`,
    
    virtualization: {
      type: 'vm',
      hypervisor: 'azure-hyperv',
    },
    
    // Azure-specific data goes in extendedData
    extendedData: {
      azureVmSize: vm.vmSize,
      azureLocation: vm.location,
      azureResourceGroup: vm.resourceGroup,
      azureSubscriptionId: vm.subscriptionId,
      azurePowerState: vm.powerState,
      azureProvisioningState: vm.provisioningState,
      azureTags: vm.tags,
      azureResourceId: vm.id,
    },
  };
}

/**
 * Main collection function
 */
async function collect(): Promise<void> {
  const startTime = Date.now();
  
  logger.info('🚀 Starting Azure VMs collection...');
  
  try {
    // Connect to MongoDB
    await mongoInstance.connect();
    
    // Fetch Azure VMs
    logger.info('📡 Fetching Azure VMs...');
    const vms = await fetchAzureVMs();
    logger.info(`Found ${vms.length} VMs`);
    
    // Transform to normalized schema
    logger.info('🔄 Transforming to AssetComputer schema...');
    const assets = vms.map(transformAzureVMToAsset);
    
    // Create snapshot
    logger.info('📸 Creating snapshot...');
    const collectionDuration = Date.now() - startTime;
    const snapshotResult = createSnapshot<AssetComputer>(
      'azure-vms',
      'AssetComputer',
      1,
      assets,
      { allowPartialSuccess: true, collectionDuration }
    );
    
    if (!snapshotResult.success) {
      throw new Error(`Snapshot creation failed: ${snapshotResult.error}`);
    }
    
    // Insert to MongoDB
    logger.info('💾 Inserting snapshot to MongoDB...');
    const collection = mongoInstance.getCollectionForSource('azure-vms');
    const insertedId = await mongoInstance.insertSnapshot(collection, snapshotResult.snapshot);
    
    logger.info('✅ Collection complete!');
    logger.info(`   - Snapshot ID: ${insertedId}`);
    logger.info(`   - Total items: ${snapshotResult.snapshot.metadata.totalItems}`);
    logger.info(`   - Valid items: ${snapshotResult.snapshot.metadata.validItems}`);
    logger.info(`   - Duration: ${collectionDuration}ms`);
    
  } catch (error) {
    logger.error(`❌ Collection failed: ${error}`);
    throw error;
  } finally {
    await mongoInstance.disconnect();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  collect()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error(`${error}`);
      process.exit(1);
    });
}

export { collect };
