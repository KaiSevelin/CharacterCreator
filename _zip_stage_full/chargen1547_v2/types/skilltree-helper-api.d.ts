export type SkillTreeNodeId = string;

export interface SkillTreeRequirement {
    nodeId: SkillTreeNodeId;
    minLevel: number;
}

export interface SkillTreeAnyOfGroup {
    options: SkillTreeRequirement[];
}

export interface SkillTreeNodeData {
    name?: string;
    type?: string;
    requirements?: SkillTreeRequirement[];
    anyOf?: SkillTreeAnyOfGroup[];
}

export type SkillTreeGraphData = Record<SkillTreeNodeId, SkillTreeNodeData>;

export interface SkillTreeMissingRequirement {
    nodeId: SkillTreeNodeId;
    need: number;
    have: number;
    hasItem?: boolean;
    implicit?: boolean;
}

export interface SkillTreeMissingAnyOf {
    type: "anyOf";
    options: SkillTreeMissingRequirement[];
}

export type SkillTreeMissingEntry = SkillTreeMissingRequirement | SkillTreeMissingAnyOf;

export interface SkillTreeUnlockCheck {
    ok: boolean;
    missing: SkillTreeMissingEntry[];
    have?: number;
    reason?: string;
}

export interface SkillTreeEvaluationEntry {
    currentLevel: number;
    canAdvance: boolean;
    missing: SkillTreeMissingEntry[];
}

export interface SkillTreeGrantableNode {
    nodeId: SkillTreeNodeId;
    level: number;
    currentLevel: number;
    name: string;
    type: string;
}

export interface SkillTreeGrantedResult {
    nodeId: SkillTreeNodeId;
    level: number;
    itemId: string | null;
    created: boolean;
}

export interface SkillTreeGrantResult {
    ok: boolean;
    granted: SkillTreeGrantedResult | null;
    reason?: "nothing-to-grant" | "source-not-found";
    next?: SkillTreeGrantableNode;
}

export interface SkillTreeManeuverUnavailable {
    item: Item;
    reasons: Array<
        | { type: "weapon-trait"; requiredTrait: string; equippedWeapons: number }
        | { type: "graph-prerequisite"; missing: SkillTreeMissingEntry[] }
    >;
}

export interface SkillTreeManeuverResult {
    available: Item[];
    unavailable?: SkillTreeManeuverUnavailable[];
}

export interface SkillTreeApi {
    buildSkillGraph(graphData?: SkillTreeGraphData): { nodes: Map<string, unknown> };
    detectCycles(graph: { nodes: Map<string, { requirements?: SkillTreeRequirement[]; anyOf?: SkillTreeAnyOfGroup[] }> }): string[][];
    validateGraphData(graphData: SkillTreeGraphData): SkillTreeGraphData;
    normalizeGraphData(graphData: unknown): SkillTreeGraphData;
    exportGraphData(graph: { nodes: Map<string, unknown> }): SkillTreeGraphData;
    importGraphData(actor: Actor | null, graphData: SkillTreeGraphData): Promise<void>;
    getGraphData(): Promise<SkillTreeGraphData>;
    setGraphData(graphData: SkillTreeGraphData): Promise<void>;

    getActorNodeLevels(actor: Actor, graphData: SkillTreeGraphData): Map<string, number>;
    resolveNodeIdForItem(item: Item, graphData: SkillTreeGraphData): string | null;
    bindItemToNode(item: Item, nodeId: string): Promise<string | null>;
    ensureActorItemNodeRef(item: Item, graphData: SkillTreeGraphData): Promise<string | null>;
    ensureActorNodeRefs(actor: Actor, graphData: SkillTreeGraphData): Promise<Array<{ itemId: string; nodeId: string }>>;

    validateActorUnlock(actor: Actor, nodeId: string, targetLevel?: number, graphData?: SkillTreeGraphData): SkillTreeUnlockCheck;
    evaluateGraphForActor(actor: Actor, graphData?: SkillTreeGraphData): Record<string, SkillTreeEvaluationEntry>;

    getFirstGrantableNode(actor: Actor, nodeId: string, targetLevel?: number, graphData?: SkillTreeGraphData): SkillTreeGrantableNode | null;
    getFirstGrantableNodeFromWorldGraph(actor: Actor, nodeId: string, targetLevel?: number): Promise<SkillTreeGrantableNode | null>;
    grantFirstAvailableNode(actor: Actor, nodeId: string, targetLevel?: number, options?: { graphData?: SkillTreeGraphData }): Promise<SkillTreeGrantResult>;

    getAvailableManeuvers(actor: Actor, options?: {
        maneuverTemplate?: string;
        weaponTemplate?: string;
        requiredTraitField?: string;
        weaponTraitsField?: string;
        includeUnavailable?: boolean;
        requireGraphUnlock?: boolean;
        graphData?: SkillTreeGraphData;
        targetLevel?: number;
    }): Promise<SkillTreeManeuverResult>;

    setNodeLevel(actor: Actor, nodeId: string, targetLevel: number): Promise<SkillTreeUnlockCheck>;
    setSkillLevel(actor: Actor, skillId: string, targetLevel: number): Promise<SkillTreeUnlockCheck>;
}

declare global {
    var SkillTree: SkillTreeApi;
}

export {};
