import Database from 'better-sqlite3';
import { VectorStore } from './vector-store.js';
import { KnowledgeGraphManager } from './knowledge-graph.js';

export interface AgentTask {
  id: string;
  type: 'analyze' | 'synthesize' | 'search' | 'extract';
  input: any;
  context?: any;
  priority?: 'high' | 'normal' | 'low';
}

export interface AgentResult {
  taskId: string;
  agentType: string;
  output: any;
  confidence: number;
  reasoning?: string;
  processingTime: number;
}

export interface AgentCapability {
  name: string;
  description: string;
  inputTypes: string[];
  outputTypes: string[];
}

// Base Agent class
export abstract class Agent {
  protected name: string;
  protected capabilities: AgentCapability[];

  constructor(name: string, capabilities: AgentCapability[]) {
    this.name = name;
    this.capabilities = capabilities;
  }

  abstract process(task: AgentTask): Promise<AgentResult>;

  canHandle(task: AgentTask): boolean {
    return this.capabilities.some(cap => cap.inputTypes.includes(task.type));
  }

  getName(): string {
    return this.name;
  }
}

// Analyzer Agent - Analyzes context to extract insights
export class AnalyzerAgent extends Agent {
  constructor(
    private db: Database.Database,
    private knowledgeGraph: KnowledgeGraphManager,
    private vectorStore: VectorStore
  ) {
    super('analyzer', [
      {
        name: 'pattern_detection',
        description: 'Detect patterns in saved context',
        inputTypes: ['analyze'],
        outputTypes: ['patterns', 'insights'],
      },
      {
        name: 'relationship_extraction',
        description: 'Extract relationships between entities',
        inputTypes: ['analyze'],
        outputTypes: ['relationships'],
      },
      {
        name: 'trend_analysis',
        description: 'Analyze trends over time',
        inputTypes: ['analyze'],
        outputTypes: ['trends'],
      },
    ]);
  }

  async process(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();

    switch (task.input.analysisType) {
      case 'patterns':
        return this.analyzePatterns(task, startTime);
      case 'relationships':
        return this.analyzeRelationships(task, startTime);
      case 'trends':
        return this.analyzeTrends(task, startTime);
      case 'comprehensive':
        return this.comprehensiveAnalysis(task, startTime);
      default:
        return {
          taskId: task.id,
          agentType: this.name,
          output: { error: 'Unknown analysis type' },
          confidence: 0,
          processingTime: Date.now() - startTime,
        };
    }
  }

  private async analyzePatterns(task: AgentTask, startTime: number): Promise<AgentResult> {
    const { sessionId, categories, timeframe } = task.input;

    // Get context items
    let query = `
      SELECT key, value, category, priority, created_at
      FROM context_items
      WHERE session_id = ?
    `;
    const params: any[] = [sessionId];

    if (categories && categories.length > 0) {
      query += ` AND category IN (${categories.map(() => '?').join(',')})`;
      params.push(...categories);
    }

    if (timeframe) {
      query += ` AND created_at >= datetime('now', ?)`;
      params.push(timeframe);
    }

    const items = this.db.prepare(query).all(...params);

    // Analyze patterns
    const patterns = {
      categoryDistribution: this.getCategoryDistribution(items),
      priorityDistribution: this.getPriorityDistribution(items),
      temporalPatterns: this.getTemporalPatterns(items),
      keywordFrequency: this.getKeywordFrequency(items),
      workflowPatterns: this.detectWorkflowPatterns(items),
    };

    const confidence = items.length > 10 ? 0.9 : 0.7;

    return {
      taskId: task.id,
      agentType: this.name,
      output: {
        patterns,
        itemCount: items.length,
        insights: this.generatePatternInsights(patterns),
      },
      confidence,
      reasoning: `Analyzed ${items.length} context items to identify patterns`,
      processingTime: Date.now() - startTime,
    };
  }

  private async analyzeRelationships(task: AgentTask, startTime: number): Promise<AgentResult> {
    const { sessionId, entityType, _maxDepth = 2 } = task.input;

    // Get entities and relationships from knowledge graph
    let entityQuery = 'SELECT * FROM entities WHERE session_id = ?';
    const entityParams: any[] = [sessionId];

    if (entityType) {
      entityQuery += ' AND type = ?';
      entityParams.push(entityType);
    }

    const entities = this.db.prepare(entityQuery).all(...entityParams) as any[];
    const relationships: any[] = [];

    for (const entity of entities) {
      const relations = this.db
        .prepare(
          `
        SELECT r.*, e.name as object_name, e.type as object_type
        FROM relations r
        JOIN entities e ON r.object_id = e.id
        WHERE r.subject_id = ?
      `
        )
        .all(entity.id) as any[];

      relationships.push({
        entity,
        relationships: relations.map(r => ({
          predicate: r.predicate,
          objectId: r.object_id,
          objectName: r.object_name,
          objectType: r.object_type,
          confidence: r.confidence,
        })),
      });
    }

    // Analyze relationship patterns
    const analysis = {
      entityCount: entities.length,
      relationshipTypes: this.getRelationshipTypes(relationships),
      clusters: this.detectClusters(relationships),
      centralNodes: this.findCentralNodes(relationships),
      isolatedEntities: this.findIsolatedEntities(entities, relationships),
    };

    return {
      taskId: task.id,
      agentType: this.name,
      output: {
        analysis,
        recommendations: this.generateRelationshipRecommendations(analysis),
      },
      confidence: 0.85,
      reasoning: `Analyzed ${entities.length} entities and their relationships`,
      processingTime: Date.now() - startTime,
    };
  }

  private async analyzeTrends(task: AgentTask, startTime: number): Promise<AgentResult> {
    const { sessionId, metric: _metric, timeframe = '-7 days' } = task.input;

    // Get time-series data
    const query = `
      SELECT 
        date(created_at) as date,
        COUNT(*) as count,
        category,
        priority
      FROM context_items
      WHERE session_id = ?
        AND created_at >= datetime('now', ?)
      GROUP BY date(created_at), category, priority
      ORDER BY date
    `;

    const trends = this.db.prepare(query).all(sessionId, timeframe);

    // Analyze trends
    const analysis = {
      activityTrend: this.calculateActivityTrend(trends),
      categoryTrends: this.calculateCategoryTrends(trends),
      priorityShifts: this.detectPriorityShifts(trends),
      predictions: this.generatePredictions(trends),
    };

    return {
      taskId: task.id,
      agentType: this.name,
      output: {
        trends: analysis,
        summary: this.generateTrendSummary(analysis),
      },
      confidence: 0.8,
      reasoning: `Analyzed trends over ${timeframe} period`,
      processingTime: Date.now() - startTime,
    };
  }

  private async comprehensiveAnalysis(task: AgentTask, startTime: number): Promise<AgentResult> {
    // Run all analysis types
    const [patterns, relationships, trends] = await Promise.all([
      this.analyzePatterns(
        { ...task, input: { ...task.input, analysisType: 'patterns' } },
        Date.now()
      ),
      this.analyzeRelationships(
        { ...task, input: { ...task.input, analysisType: 'relationships' } },
        Date.now()
      ),
      this.analyzeTrends({ ...task, input: { ...task.input, analysisType: 'trends' } }, Date.now()),
    ]);

    return {
      taskId: task.id,
      agentType: this.name,
      output: {
        patterns: patterns.output,
        relationships: relationships.output,
        trends: trends.output,
        overallInsights: this.generateOverallInsights(
          patterns.output,
          relationships.output,
          trends.output
        ),
      },
      confidence: 0.9,
      reasoning: 'Performed comprehensive analysis across patterns, relationships, and trends',
      processingTime: Date.now() - startTime,
    };
  }

  // Helper methods
  private getCategoryDistribution(items: any[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const item of items) {
      const category = item.category || 'uncategorized';
      distribution[category] = (distribution[category] || 0) + 1;
    }
    return distribution;
  }

  private getPriorityDistribution(items: any[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const item of items) {
      const priority = item.priority || 'normal';
      distribution[priority] = (distribution[priority] || 0) + 1;
    }
    return distribution;
  }

  private getTemporalPatterns(items: any[]): any {
    // Group by hour of day and day of week
    const hourly: Record<number, number> = {};
    const daily: Record<string, number> = {};

    for (const item of items) {
      const date = new Date(item.created_at);
      const hour = date.getHours();
      const day = date.toLocaleDateString('en-US', { weekday: 'long' });

      hourly[hour] = (hourly[hour] || 0) + 1;
      daily[day] = (daily[day] || 0) + 1;
    }

    return { hourly, daily };
  }

  private getKeywordFrequency(items: any[]): Record<string, number> {
    const frequency: Record<string, number> = {};
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
    ]);

    for (const item of items) {
      const text = `${item.key} ${item.value}`.toLowerCase();
      const words = text.match(/\b\w+\b/g) || [];

      for (const word of words) {
        if (word.length > 3 && !stopWords.has(word)) {
          frequency[word] = (frequency[word] || 0) + 1;
        }
      }
    }

    // Return top 20 keywords
    return Object.fromEntries(
      Object.entries(frequency)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
    );
  }

  private detectWorkflowPatterns(items: any[]): any {
    // Simple workflow detection based on temporal ordering and categories
    const workflows: any[] = [];
    const sortedItems = [...items].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    let currentWorkflow: any[] = [];
    let lastCategory = '';

    for (const item of sortedItems) {
      if (item.category !== lastCategory && currentWorkflow.length > 0) {
        workflows.push({
          steps: currentWorkflow.length,
          categories: [...new Set(currentWorkflow.map(i => i.category))],
          duration:
            new Date(currentWorkflow[currentWorkflow.length - 1].created_at).getTime() -
            new Date(currentWorkflow[0].created_at).getTime(),
        });
        currentWorkflow = [];
      }
      currentWorkflow.push(item);
      lastCategory = item.category;
    }

    return workflows;
  }

  private generatePatternInsights(patterns: any): string[] {
    const insights: string[] = [];

    // Category insights
    const topCategory = Object.entries(patterns.categoryDistribution).sort(
      ([, a], [, b]) => (b as number) - (a as number)
    )[0];
    if (topCategory) {
      insights.push(`Most activity in '${topCategory[0]}' category (${topCategory[1]} items)`);
    }

    // Priority insights
    if (patterns.priorityDistribution.high > patterns.priorityDistribution.normal) {
      insights.push(
        'High concentration of high-priority items - consider delegating or breaking down tasks'
      );
    }

    // Temporal insights
    const peakHour = Object.entries(patterns.temporalPatterns.hourly).sort(
      ([, a], [, b]) => (b as number) - (a as number)
    )[0];
    if (peakHour) {
      insights.push(`Peak activity at ${peakHour[0]}:00 hours`);
    }

    return insights;
  }

  private getRelationshipTypes(relationships: any[]): Record<string, number> {
    const types: Record<string, number> = {};

    for (const rel of relationships) {
      for (const r of rel.relationships) {
        types[r.predicate] = (types[r.predicate] || 0) + 1;
      }
    }

    return types;
  }

  private detectClusters(relationships: any[]): any[] {
    // Simple clustering based on connectivity
    const clusters: any[] = [];
    const visited = new Set<string>();

    for (const rel of relationships) {
      if (!visited.has(rel.entity.id)) {
        const cluster = this.buildCluster(rel.entity.id, relationships, visited);
        if (cluster.size > 1) {
          clusters.push(cluster);
        }
      }
    }

    return clusters;
  }

  private buildCluster(entityId: string, relationships: any[], visited: Set<string>): any {
    const cluster = {
      entities: [entityId],
      size: 1,
    };

    visited.add(entityId);

    const relatedEntities = relationships.find(r => r.entity.id === entityId)?.relationships || [];

    for (const related of relatedEntities) {
      if (!visited.has(related.objectId)) {
        const subCluster = this.buildCluster(related.objectId, relationships, visited);
        cluster.entities.push(...subCluster.entities);
        cluster.size += subCluster.size;
      }
    }

    return cluster;
  }

  private findCentralNodes(relationships: any[]): any[] {
    const connectionCount: Record<string, number> = {};

    for (const rel of relationships) {
      connectionCount[rel.entity.id] = rel.relationships.length;
    }

    return Object.entries(connectionCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([id, count]) => ({ entityId: id, connections: count }));
  }

  private findIsolatedEntities(entities: any[], relationships: any[]): any[] {
    const connected = new Set(relationships.map(r => r.entity.id));
    return entities.filter(e => !connected.has(e.id));
  }

  private generateRelationshipRecommendations(analysis: any): string[] {
    const recommendations: string[] = [];

    if (analysis.isolatedEntities.length > 0) {
      recommendations.push(
        `${analysis.isolatedEntities.length} isolated entities found - consider documenting their relationships`
      );
    }

    if (analysis.clusters.length > 1) {
      recommendations.push(
        `${analysis.clusters.length} separate clusters detected - look for cross-cluster connections`
      );
    }

    if (analysis.centralNodes.length > 0) {
      recommendations.push(
        `Key entities: ${analysis.centralNodes
          .slice(0, 3)
          .map((n: any) => n.entityId)
          .join(', ')}`
      );
    }

    return recommendations;
  }

  private calculateActivityTrend(trends: any[]): any {
    const dailyCounts = trends.reduce((acc: Record<string, number>, item) => {
      acc[item.date] = (acc[item.date] || 0) + item.count;
      return acc;
    }, {});

    const values = Object.values(dailyCounts);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const recent = values.slice(-3).reduce((a, b) => a + b, 0) / 3;

    return {
      direction: recent > avg ? 'increasing' : recent < avg ? 'decreasing' : 'stable',
      averageDaily: avg,
      recentDaily: recent,
    };
  }

  private calculateCategoryTrends(trends: any[]): any {
    const categoryTrends: Record<string, any> = {};

    for (const trend of trends) {
      if (!categoryTrends[trend.category]) {
        categoryTrends[trend.category] = { dates: [], counts: [] };
      }
      categoryTrends[trend.category].dates.push(trend.date);
      categoryTrends[trend.category].counts.push(trend.count);
    }

    return categoryTrends;
  }

  private detectPriorityShifts(trends: any[]): any {
    const priorityByDate: Record<string, Record<string, number>> = {};

    for (const trend of trends) {
      if (!priorityByDate[trend.date]) {
        priorityByDate[trend.date] = {};
      }
      priorityByDate[trend.date][trend.priority] = trend.count;
    }

    return priorityByDate;
  }

  private generatePredictions(trends: any[]): any {
    // Simple linear prediction
    return {
      nextDayEstimate: Math.round(trends[trends.length - 1]?.count * 1.1 || 0),
      confidence: 0.6,
    };
  }

  private generateTrendSummary(analysis: any): string {
    return `Activity is ${analysis.activityTrend.direction} with an average of ${analysis.activityTrend.averageDaily.toFixed(1)} items per day`;
  }

  private generateOverallInsights(patterns: any, relationships: any, trends: any): string[] {
    return [
      ...(patterns.insights || []),
      ...(relationships.recommendations || []),
      trends.summary || '',
    ].filter(Boolean);
  }
}

// Synthesizer Agent - Synthesizes information from multiple sources
export class SynthesizerAgent extends Agent {
  constructor(
    private db: Database.Database,
    private vectorStore: VectorStore
  ) {
    super('synthesizer', [
      {
        name: 'summarization',
        description: 'Create summaries from multiple context items',
        inputTypes: ['synthesize'],
        outputTypes: ['summary'],
      },
      {
        name: 'merge_insights',
        description: 'Merge insights from multiple agents',
        inputTypes: ['synthesize'],
        outputTypes: ['merged_insights'],
      },
      {
        name: 'generate_recommendations',
        description: 'Generate actionable recommendations',
        inputTypes: ['synthesize'],
        outputTypes: ['recommendations'],
      },
    ]);
  }

  async process(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();

    switch (task.input.synthesisType) {
      case 'summary':
        return this.createSummary(task, startTime);
      case 'merge':
        return this.mergeInsights(task, startTime);
      case 'recommendations':
        return this.generateRecommendations(task, startTime);
      default:
        return {
          taskId: task.id,
          agentType: this.name,
          output: { error: 'Unknown synthesis type' },
          confidence: 0,
          processingTime: Date.now() - startTime,
        };
    }
  }

  private async createSummary(task: AgentTask, startTime: number): Promise<AgentResult> {
    const { sessionId, categories, maxLength = 1000 } = task.input;

    // Get relevant context items
    let query = `
      SELECT key, value, category, priority, created_at
      FROM context_items
      WHERE session_id = ?
    `;
    const params: any[] = [sessionId];

    if (categories && categories.length > 0) {
      query += ` AND category IN (${categories.map(() => '?').join(',')})`;
      params.push(...categories);
    }

    query += ` ORDER BY priority DESC, created_at DESC LIMIT 50`;

    const items = this.db.prepare(query).all(...params);

    // Create structured summary
    const summary = {
      overview: this.createOverview(items),
      byCategory: this.summarizeByCategory(items),
      keyDecisions: this.extractKeyDecisions(items),
      currentTasks: this.extractCurrentTasks(items),
      recentProgress: this.extractRecentProgress(items),
    };

    // Trim to maxLength
    const formattedSummary = this.formatSummary(summary, maxLength);

    return {
      taskId: task.id,
      agentType: this.name,
      output: {
        summary: formattedSummary,
        itemCount: items.length,
        categories: [...new Set(items.map((i: any) => i.category))].filter(Boolean),
      },
      confidence: 0.85,
      reasoning: `Synthesized ${items.length} items into structured summary`,
      processingTime: Date.now() - startTime,
    };
  }

  private async mergeInsights(task: AgentTask, startTime: number): Promise<AgentResult> {
    const { insights } = task.input;

    if (!Array.isArray(insights) || insights.length === 0) {
      return {
        taskId: task.id,
        agentType: this.name,
        output: { error: 'No insights provided to merge' },
        confidence: 0,
        processingTime: Date.now() - startTime,
      };
    }

    // Merge and deduplicate insights
    const merged = {
      patterns: this.mergePatterns(insights),
      relationships: this.mergeRelationships(insights),
      trends: this.mergeTrends(insights),
      overallThemes: this.identifyThemes(insights),
      conflicts: this.identifyConflicts(insights),
    };

    return {
      taskId: task.id,
      agentType: this.name,
      output: merged,
      confidence: 0.8,
      reasoning: `Merged ${insights.length} insight sources`,
      processingTime: Date.now() - startTime,
    };
  }

  private async generateRecommendations(task: AgentTask, startTime: number): Promise<AgentResult> {
    const { analysisResults, context: _context } = task.input;

    // If no analysisResults provided, try to extract from context (for chaining)
    let analysis = analysisResults;
    if (!analysis && task.context) {
      // Extract analysis data from previous agent output
      if (task.context.patterns || task.context.trends) {
        analysis = {
          highPriorityCount: task.context.patterns?.priorityDistribution?.high || 0,
          contextSize: task.context.itemCount || 0,
          staleTasks: false,
        };
      }
    }

    const recommendations = {
      immediate: this.getImmediateRecommendations(analysis),
      shortTerm: this.getShortTermRecommendations(analysis),
      longTerm: this.getLongTermRecommendations(analysis),
      warnings: this.getWarnings(analysis),
    };

    return {
      taskId: task.id,
      agentType: this.name,
      output: recommendations,
      confidence: 0.75,
      reasoning: 'Generated recommendations based on analysis results',
      processingTime: Date.now() - startTime,
    };
  }

  // Helper methods
  private createOverview(items: any[]): string {
    const totalItems = items.length;
    const highPriority = items.filter(i => i.priority === 'high').length;
    const categories = [...new Set(items.map(i => i.category))].filter(Boolean);

    return `${totalItems} context items across ${categories.length} categories, with ${highPriority} high-priority items`;
  }

  private summarizeByCategory(items: any[]): Record<string, any> {
    const byCategory: Record<string, any> = {};

    for (const item of items) {
      const category = item.category || 'uncategorized';
      if (!byCategory[category]) {
        byCategory[category] = {
          count: 0,
          items: [],
          priorities: { high: 0, normal: 0, low: 0 },
        };
      }

      byCategory[category].count++;
      byCategory[category].items.push({
        key: item.key,
        value: item.value.substring(0, 100) + (item.value.length > 100 ? '...' : ''),
      });
      byCategory[category].priorities[item.priority || 'normal']++;
    }

    return byCategory;
  }

  private extractKeyDecisions(items: any[]): string[] {
    return items
      .filter(i => i.category === 'decision' && i.priority === 'high')
      .map(i => `${i.key}: ${i.value}`)
      .slice(0, 5);
  }

  private extractCurrentTasks(items: any[]): string[] {
    return items
      .filter(i => i.category === 'task')
      .sort((a, b) => {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        return (
          (priorityOrder[a.priority as keyof typeof priorityOrder] || 1) -
          (priorityOrder[b.priority as keyof typeof priorityOrder] || 1)
        );
      })
      .map(i => `[${i.priority}] ${i.key}: ${i.value}`)
      .slice(0, 10);
  }

  private extractRecentProgress(items: any[]): string[] {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    return items
      .filter(i => i.category === 'progress' && new Date(i.created_at) > oneDayAgo)
      .map(i => i.value)
      .slice(0, 5);
  }

  private formatSummary(summary: any, maxLength: number): string {
    let formatted = `# Context Summary\n\n${summary.overview}\n\n`;

    if (summary.keyDecisions.length > 0) {
      formatted += `## Key Decisions\n${summary.keyDecisions.map((d: string) => `- ${d}`).join('\n')}\n\n`;
    }

    if (summary.currentTasks.length > 0) {
      formatted += `## Current Tasks\n${summary.currentTasks.map((t: string) => `- ${t}`).join('\n')}\n\n`;
    }

    if (summary.recentProgress.length > 0) {
      formatted += `## Recent Progress\n${summary.recentProgress.map((p: string) => `- ${p}`).join('\n')}\n\n`;
    }

    // Trim if needed
    if (formatted.length > maxLength) {
      formatted = formatted.substring(0, maxLength - 3) + '...';
    }

    return formatted;
  }

  private mergePatterns(insights: any[]): any {
    const merged: any = {};

    for (const insight of insights) {
      if (insight.patterns) {
        Object.entries(insight.patterns).forEach(([key, value]) => {
          if (!merged[key]) {
            merged[key] = value;
          } else if (Array.isArray(value)) {
            merged[key] = [...new Set([...merged[key], ...value])];
          }
        });
      }
    }

    return merged;
  }

  private mergeRelationships(insights: any[]): any {
    const entities = new Map();
    const relationships = new Map();

    for (const insight of insights) {
      if (insight.relationships) {
        // Merge logic for relationships
      }
    }

    return { entities: entities.size, relationships: relationships.size };
  }

  private mergeTrends(insights: any[]): any {
    const trends: any[] = [];

    for (const insight of insights) {
      if (insight.trends) {
        trends.push(insight.trends);
      }
    }

    return trends;
  }

  private identifyThemes(insights: any[]): string[] {
    const themes = new Set<string>();

    // Extract common themes from insights
    for (const insight of insights) {
      if (
        insight &&
        typeof insight === 'object' &&
        insight.themes &&
        Array.isArray(insight.themes)
      ) {
        insight.themes.forEach((theme: string) => themes.add(theme));
      }
    }

    return Array.from(themes);
  }

  private identifyConflicts(_insights: any[]): any[] {
    // Identify conflicting information between insights
    return [];
  }

  private getImmediateRecommendations(analysis: any): string[] {
    const recommendations: string[] = [];

    if (analysis && analysis.highPriorityCount > 5) {
      recommendations.push('Consider breaking down high-priority tasks into smaller items');
    }

    if (analysis && analysis.staleTasks) {
      recommendations.push("Review and update stale tasks that haven't been touched recently");
    }

    return recommendations;
  }

  private getShortTermRecommendations(_analysis: any): string[] {
    return ['Create checkpoints before major changes', "Document key decisions as they're made"];
  }

  private getLongTermRecommendations(_analysis: any): string[] {
    return [
      'Establish regular review cycles for context cleanup',
      'Consider archiving old sessions',
    ];
  }

  private getWarnings(analysis: any): string[] {
    const warnings: string[] = [];

    if (analysis && analysis.contextSize > 1000) {
      warnings.push('Context size is large - consider compaction');
    }

    return warnings;
  }
}

// Agent Coordinator - Manages multiple agents
export class AgentCoordinator {
  private agents: Map<string, Agent> = new Map();
  private taskQueue: AgentTask[] = [];
  private results: Map<string, AgentResult> = new Map();

  registerAgent(agent: Agent): void {
    this.agents.set(agent.getName(), agent);
  }

  async delegate(task: AgentTask): Promise<AgentResult[]> {
    // Find suitable agents
    const suitableAgents = Array.from(this.agents.values()).filter(agent => agent.canHandle(task));

    if (suitableAgents.length === 0) {
      return [
        {
          taskId: task.id,
          agentType: 'coordinator',
          output: { error: 'No suitable agent found for task' },
          confidence: 0,
          processingTime: 0,
        },
      ];
    }

    // Process with all suitable agents in parallel
    const results = await Promise.all(suitableAgents.map(agent => agent.process(task)));

    // Store results
    results.forEach(result => {
      this.results.set(`${task.id}-${result.agentType}`, result);
    });

    return results;
  }

  async processChain(tasks: AgentTask[]): Promise<AgentResult[]> {
    const chainResults: AgentResult[] = [];
    let previousOutput = null;

    for (const task of tasks) {
      // Pass previous output as context
      if (previousOutput) {
        task.context = previousOutput;
      }

      const results = await this.delegate(task);
      chainResults.push(...results);

      // Use the highest confidence result as input for next task
      previousOutput = results.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      ).output;
    }

    return chainResults;
  }

  getBestResult(taskId: string): AgentResult | null {
    const taskResults = Array.from(this.results.entries())
      .filter(([key]) => key.startsWith(taskId))
      .map(([, result]) => result);

    if (taskResults.length === 0) return null;

    return taskResults.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );
  }

  getAgentCapabilities(): Record<string, AgentCapability[]> {
    const capabilities: Record<string, AgentCapability[]> = {};

    this.agents.forEach((agent, name) => {
      capabilities[name] = (agent as any).capabilities;
    });

    return capabilities;
  }
}
