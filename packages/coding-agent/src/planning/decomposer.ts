export interface DecomposeTaskInput {
	goal: string;
	constraints?: string[];
	files?: string[];
}

export interface DecomposedTask {
	id: string;
	description: string;
	dependsOn: string[];
}

export function decomposeTask(input: DecomposeTaskInput): DecomposedTask[] {
	const tasks: DecomposedTask[] = [];
	const normalizedGoal = input.goal.trim();
	if (normalizedGoal.length === 0) {
		return tasks;
	}

	tasks.push({
		id: "analyze-scope",
		description: `Analyze scope for: ${normalizedGoal}`,
		dependsOn: [],
	});

	if ((input.files?.length ?? 0) > 0) {
		tasks.push({
			id: "inspect-files",
			description: `Inspect target files: ${input.files?.join(", ")}`,
			dependsOn: ["analyze-scope"],
		});
	}

	if ((input.constraints?.length ?? 0) > 0) {
		tasks.push({
			id: "apply-constraints",
			description: `Apply constraints: ${input.constraints?.join(", ")}`,
			dependsOn: ["analyze-scope"],
		});
	}

	tasks.push({
		id: "execute-change",
		description: `Execute work for: ${normalizedGoal}`,
		dependsOn: tasks.filter(task => task.id !== "execute-change").map(task => task.id),
	});

	return tasks;
}
