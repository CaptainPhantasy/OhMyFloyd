export type AgentConfig = {
  name: string;
  domain?: string;
  capabilities?: string[];
};

export class BaseAgent {
  constructor(public config: AgentConfig) {}

  async executeTask(task: string, context: any): Promise<any> {
    throw new Error(`Task ${task} not implemented`);
  }
}