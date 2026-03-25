export interface SymbolEntry {
	name: string;
	kind: string;
	filePath: string;
	line: number;
}

export class SymbolIndex {
	readonly #entries = new Map<string, SymbolEntry[]>();

	add(entry: SymbolEntry): void {
		const bucket = this.#entries.get(entry.name) ?? [];
		bucket.push(entry);
		this.#entries.set(entry.name, bucket);
	}

	addMany(entries: SymbolEntry[]): void {
		for (const entry of entries) {
			this.add(entry);
		}
	}

	find(name: string): SymbolEntry[] {
		return [...(this.#entries.get(name) ?? [])].sort((left, right) => {
			if (left.filePath === right.filePath) return left.line - right.line;
			return left.filePath.localeCompare(right.filePath);
		});
	}

	listNames(): string[] {
		return Array.from(this.#entries.keys()).sort((left, right) => left.localeCompare(right));
	}
}
