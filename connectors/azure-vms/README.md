# Azure VMs Connector

Collects Azure Virtual Machine information and normalizes it to the `AssetComputer` schema.

## Configuration

Set these environment variables in your `.env` file:

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=prism

# Azure Credentials
AZURE_TENANT_ID=your_tenant_id
AZURE_CLIENT_ID=your_client_id
AZURE_CLIENT_SECRET=your_client_secret
AZURE_SUBSCRIPTION_ID=your_subscription_id
```

## Running Locally

```bash
# Install dependencies
npm install

# Run connector
npm run collect:azure-vms
```

## Production Setup

### Install Azure SDK

For production use, install the Azure SDK:

```bash
npm install @azure/arm-compute @azure/identity
```

Then update `collect.ts` to use real Azure API calls:

```typescript
import { ComputeManagementClient } from '@azure/arm-compute';
import { DefaultAzureCredential } from '@azure/identity';

async function fetchAzureVMs(): Promise<AzureVM[]> {
  const credential = new DefaultAzureCredential();
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || '';
  
  const computeClient = new ComputeManagementClient(credential, subscriptionId);
  
  const vms: AzureVM[] = [];
  
  // List all VMs in subscription
  for await (const vm of computeClient.virtualMachines.listAll()) {
    // Get instance view for power state
    const instanceView = await computeClient.virtualMachines.instanceView(
      vm.resourceGroup,
      vm.name
    );
    
    const powerState = instanceView.statuses?.find(s => 
      s.code?.startsWith('PowerState/')
    )?.code?.replace('PowerState/', '') || 'unknown';
    
    vms.push({
      id: vm.id,
      name: vm.name,
      location: vm.location,
      vmSize: vm.hardwareProfile?.vmSize || '',
      powerState,
      osType: vm.storageProfile?.osDisk?.osType || '',
      resourceGroup: vm.id.split('/')[4], // Extract from resource ID
      subscriptionId,
      tags: vm.tags || {},
      provisioningState: vm.provisioningState || '',
      // Add network info from network interfaces...
    });
  }
  
  return vms;
}
```

### Azure Authentication

Use one of these authentication methods:

1. **Service Principal** (recommended for production)
2. **Managed Identity** (when running in Azure)
3. **Azure CLI** (for local development)

### Required Azure Permissions

The service principal needs these roles:
- `Reader` on subscription(s) to query VMs
- `Virtual Machine Contributor` if you need to modify VMs

## Data Mapping

### Azure VM → AssetComputer

| Azure Field | AssetComputer Field | Notes |
|------------|-------------------|-------|
| `id` | `id` | Full Azure resource ID |
| `name` | `name` | VM name |
| `vmSize` | `extendedData.azureVmSize` | Used to estimate CPU/memory |
| `powerState` | `status` | running/stopped/maintenance |
| `osType` | `os` | Linux/Windows |
| `location` | `location.region` | Azure region |
| `resourceGroup` | `location.datacenter` | Resource group name |
| `tags` | `tags` + `extendedData.azureTags` | All VM tags |

### Extended Data

Azure-specific fields stored in `extendedData`:
- `azureVmSize`: VM size (Standard_D2s_v3, etc.)
- `azureLocation`: Azure region
- `azureResourceGroup`: Resource group
- `azureSubscriptionId`: Subscription ID
- `azurePowerState`: Current power state
- `azureProvisioningState`: Provisioning status
- `azureTags`: All tags as object
- `azureResourceId`: Full resource ID

## Multi-Subscription Support

To collect from multiple subscriptions:

```typescript
const subscriptions = [
  process.env.AZURE_SUBSCRIPTION_1,
  process.env.AZURE_SUBSCRIPTION_2,
];

for (const subscriptionId of subscriptions) {
  const computeClient = new ComputeManagementClient(credential, subscriptionId);
  // ... collect VMs
}
```

## Output

Creates snapshots in MongoDB collection: `snapshots_azure-vms`

Each snapshot contains:
- Timestamp
- Schema version
- Array of normalized `AssetComputer` objects
- Metadata (item counts, validation errors, duration)

## Windmill Integration

See [../../windmill/templates/azure-vms-connector.ts](../../windmill/templates/azure-vms-connector.ts) for Windmill deployment.
