export interface DependencyNode {
	id: string;
	dependsOn: string[];
}

export interface DependencyGraph {
	nodes: Map<string, DependencyNode>;
	reverseEdges: Map<string, Set<string>>;
}

export function buildDependencyGraph(nodes: DependencyNode[]): DependencyGraph {
	const nodeMap = new Map<string, DependencyNode>();
	const reverseEdges = new Map<string, Set<string>>();

	for (const node of nodes) {
		nodeMap.set(node.id, { id: node.id, dependsOn: [...node.dependsOn] });
		for (const dependency of node.dependsOn) {
			const dependents = reverseEdges.get(dependency) ?? new Set<string>();
			dependents.add(node.id);
			reverseEdges.set(dependency, dependents);
		}
	}

	return { nodes: nodeMap, reverseEdges };
}

export function getDependents(graph: DependencyGraph, id: string): string[] {
	return Array.from(graph.reverseEdges.get(id) ?? []).sort((left, right) => left.localeCompare(right));
}

export function getTransitiveDependents(graph: DependencyGraph, id: string): string[] {
	const visited = new Set<string>();
	const queue = [...getDependents(graph, id)];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || visited.has(current)) continue;
		visited.add(current);
		queue.push(...getDependents(graph, current));
	}

	return Array.from(visited).sort((left, right) => left.localeCompare(right));
}
