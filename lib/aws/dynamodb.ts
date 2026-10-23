import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

export interface DynamoDBConfig {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  tableName?: string;
}

export class DynamoDBAdapter {
  private client: DynamoDBDocumentClient | null = null;
  private tableName: string;
  private enabled: boolean;

  constructor(config: DynamoDBConfig = {}) {
    this.tableName = config.tableName || 'homeflow-household';
    this.enabled = !!(config.accessKeyId && config.secretAccessKey);

    if (this.enabled) {
      const client = new DynamoDBClient({
        region: config.region || 'us-east-1',
        credentials: {
          accessKeyId: config.accessKeyId!,
          secretAccessKey: config.secretAccessKey!,
        },
      });
      this.client = DynamoDBDocumentClient.from(client);
    }
  }

  async get(id: string): Promise<Record<string, unknown> | null> {
    if (!this.enabled || !this.client) {
      return null;
    }

    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: { id },
      });

      const response = await this.client.send(command);
      return response.Item || null;
    } catch (error) {
      console.error('DynamoDB get failed:', error);
      return null;
    }
  }

  async put(item: Record<string, unknown>): Promise<boolean> {
    if (!this.enabled || !this.client) {
      return false;
    }

    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: item,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      console.error('DynamoDB put failed:', error);
      return false;
    }
  }

  async update(id: string, updates: Record<string, unknown>): Promise<boolean> {
    if (!this.enabled || !this.client) {
      return false;
    }

    const entries = Object.entries(updates);
    if (entries.length === 0) return false;

    try {
      const updateExpressions: string[] = [];
      const expressionNames: Record<string, string> = {};
      const expressionValues: Record<string, unknown> = {};

      entries.forEach(([key, value], index) => {
        const name = `#field${index}`;
        const placeholder = `:value${index}`;
        updateExpressions.push(`${name} = ${placeholder}`);
        expressionNames[name] = key;
        expressionValues[placeholder] = value;
      });

      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: { id },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      console.error('DynamoDB update failed:', error);
      return false;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!this.enabled || !this.client) {
      return false;
    }

    try {
      const command = new DeleteCommand({
        TableName: this.tableName,
        Key: { id },
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      console.error('DynamoDB delete failed:', error);
      return false;
    }
  }

  async scan(): Promise<Record<string, unknown>[]> {
    if (!this.enabled || !this.client) {
      return [];
    }

    try {
      const command = new ScanCommand({
        TableName: this.tableName,
      });

      const response = await this.client.send(command);
      return response.Items || [];
    } catch (error) {
      console.error('DynamoDB scan failed:', error);
      return [];
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

let instance: DynamoDBAdapter | null = null;

export function getDynamoDBAdapter(): DynamoDBAdapter {
  if (!instance) {
    instance = new DynamoDBAdapter({
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      tableName: process.env.DYNAMODB_TABLE_NAME,
    });
  }
  return instance;
}
