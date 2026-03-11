import * as dotenv from 'dotenv';
import mongoInstance from '../../lib/mongo.js';
import { createSnapshot } from '../../lib/snapshot.js';
import { createLogger } from '../../lib/logger.js';
import axios from 'axios';

dotenv.config();

const logger = createLogger('jira-assets');

/**
 * Jira Assets Collector
 * 
 * Collects asset data from Jira issues in a standard project.
 * Assets are stored as issues with custom fields for asset properties.
 * 
 * IMPORTANT: This is a stub implementation. In production, you would:
 * 1. Install axios or jira-client for API requests
 * 2. Use proper Jira credentials (API token or OAuth)
 * 3. Handle pagination for large issue sets
 * 4. Configure custom field mappings for your Jira instance
 * 5. Add error handling for API failures
 * 
 * For now, this demonstrates the collection pattern with mock data.
 */

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description?: string;
    issuetype: {
      name: string;
    };
    status: {
      name: string;
    };
    labels: string[];
    created: string;
    updated: string;
    // Custom fields (example - adjust to your Jira setup)
    customfield_10100?: string; // Asset Type
    customfield_10101?: string; // Asset ID
    customfield_10102?: string; // Location
    customfield_10103?: string; // Owner
    customfield_10104?: string; // IP Address
    customfield_10105?: string; // Serial Number
    customfield_10106?: string; // Manufacturer
    customfield_10107?: string; // Model
  };
}

/**
 * Fetch Jira issues representing assets using REST API
 */
async function fetchJiraAssets(): Promise<JiraIssue[]> {
  const jiraUrl = process.env.JIRA_URL;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraApiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY || 'ASSET';
  
  if (!jiraUrl || !jiraEmail || !jiraApiToken) {
    throw new Error('JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN are required');
  }
  
  const auth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
  
  const issues: JiraIssue[] = [];
  let startAt = 0;
  const maxResults = 100;
  
  logger.info(`Querying Jira project: ${projectKey}`);
  
  // Paginate through all issues
  while (true) {
    const response = await axios.get(
      `${jiraUrl}/rest/api/3/search`,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
        },
        params: {
          jql: `project = ${projectKey} ORDER BY created DESC`,
          startAt,
          maxResults,
          fields: [
            'summary',
            'description',
            'issuetype',
            'status',
            'labels',
            'created',
            'updated',
            'customfield_10100',
            'customfield_10101',
            'customfield_10102',
            'customfield_10103',
            'customfield_10104',
            'customfield_10105',
            'customfield_10106',
            'customfield_10107',
          ],
        },
      }
    );
    
    const data = response.data;
    issues.push(...data.issues);
    
    logger.info(`Fetched ${data.issues.length} issues (${startAt + 1}-${startAt + data.issues.length} of ${data.total})`);
    
    if (data.issues.length < maxResults) {
      break; // Last page
    }
    
    startAt += maxResults;
  }
  
  return issues;
}

/**
 * Transform Jira issue to BaseAsset schema
 * 
 * Note: Using BaseAsset instead of specific types since the asset type
 * is dynamic based on Jira custom field. In production, you could route
 * to specific schemas (AssetComputer, AssetNetwork, etc.) based on type.
 */
function transformJiraIssueToAsset(issue: JiraIssue): any {
  const fields = issue.fields;
  
  // Map Jira status to general status
  const statusMap: Record<string, string> = {
    'In Use': 'active',
    'Active': 'active',
    'Operational': 'active',
    'Maintenance': 'maintenance',
    'Retired': 'retired',
    'Disposed': 'disposed',
  };
  
  return {
    id: fields.customfield_10101 || issue.key,
    name: fields.summary,
    type: fields.customfield_10100 || 'asset',
    discoveredAt: new Date().toISOString(),
    source: 'jira-assets',
    schemaVersion: 1,
    description: fields.description || '',
    tags: fields.labels,
    
    location: fields.customfield_10102 ? {
      building: fields.customfield_10102,
    } : undefined,
    
    ownership: fields.customfield_10103 ? {
      owner: fields.customfield_10103,
    } : undefined,
    
    // Jira-specific extended data
    extendedData: {
      jiraIssueKey: issue.key,
      jiraStatus: fields.status.name,
      jiraIssueType: fields.issuetype.name,
      jiraCreated: fields.created,
      jiraUpdated: fields.updated,
      jiraIpAddress: fields.customfield_10104,
      jiraSerialNumber: fields.customfield_10105,
      jiraManufacturer: fields.customfield_10106,
      jiraModel: fields.customfield_10107,
      assetStatus: statusMap[fields.status.name] || 'unknown',
    },
  };
}

/**
 * Main collection function
 */
async function collect(): Promise<void> {
  const startTime = Date.now();
  
  logger.info('🚀 Starting Jira assets collection...');
  
  try {
    // Connect to MongoDB
    await mongoInstance.connect();
    
    // Fetch Jira issues
    logger.info('📡 Fetching Jira asset issues...');
    const issues = await fetchJiraAssets();
    logger.info(`Found ${issues.length} asset issues`);
    
    // Transform to normalized schema
    logger.info('🔄 Transforming to BaseAsset schema...');
    const assets = issues.map(transformJiraIssueToAsset);
    
    // Create snapshot
    logger.info('📸 Creating snapshot...');
    const collectionDuration = Date.now() - startTime;
    const snapshotResult = createSnapshot(
      'jira-assets',
      'BaseAsset',
      1,
      assets,
      { allowPartialSuccess: true, collectionDuration }
    );
    
    if (!snapshotResult.success) {
      throw new Error(`Snapshot creation failed: ${snapshotResult.error}`);
    }
    
    // Insert to MongoDB
    logger.info('💾 Inserting snapshot to MongoDB...');
    const collection = mongoInstance.getCollectionForSource('jira-assets');
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
