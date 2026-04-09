/**
 * Continuous Learning v3 - Behavioral Classifier
 *
 * Analyzes model text output for non-deterministic behavioral violations:
 *   1. Ignoring explicit user directives
 *   2. Asking questions after being told not to
 *   3. Claiming completion without evidence
 *
 * Each detector is a pure function: text in, violation descriptor out.
 * The classifier runs against observation text content (tool outputs,
 * model responses) captured by the observer.
 */

import type { Observation } from "./types";

// ============================================================================
// Violation Types
// ============================================================================

export interface BehavioralViolation {
	/** Violation category */
	type: "ignored_directive" | "unwanted_question" | "unsubstantiated_completion";
	/** Confidence score (0.0 - 1.0) */
	confidence: number;
	/** Human-readable description of the violation */
	description: string;
	/** The specific text fragment that triggered detection */
	evidence: string;
	/** Suggested enforcement rule */
	enforcementAction: string;
	/** Observation ID that contained the violation */
	observationId: string;
}

// ============================================================================
// Detection Patterns
// ============================================================================

/**
 * Patterns indicating the model asked a question when it should not have.
 * These fire when model output contains question patterns in contexts where
 * the user has signaled "do not ask."
 */
const QUESTION_PATTERNS = [
	/\bwould you like (?:me to|to)\b/i,
	/\bshould [iI] (?:proceed|continue|go ahead)\b/i,
	/\bdo you want (?:me to|to)\b/i,
	/\bshall [iI] (?:proceed|continue|go ahead)\b/i,
	/\bwhat (?:would you prefer|do you think|approach)\?/i,
	/\blet me know (?:if|how|what|which)\b/i,
	/\bwhich (?:option|approach|method) (?:do you|would you)\b/i,
	/\bcan you (?:clarify|confirm|specify)\b/i,
	/\bcould you (?:clarify|confirm|specify)\b/i,
	/\bplease (?:clarify|confirm|let me know)\b/i,
];

/**
 * Patterns indicating the model claimed work is done without showing evidence.
 * Matches completion claims not accompanied by evidence markers.
 */
const COMPLETION_CLAIM_PATTERNS = [
	/\b(?:I'?ve|I have) (?:completed|finished|done|implemented|fixed|resolved|updated|applied)\b/i,
	/\b(?:all|everything) (?:is |has been )?(?:done|complete|finished|updated|fixed|resolved)\b/i,
	/\b(?:changes|updates|fixes|modifications) (?:have been |are )?(?:applied|made|completed)\b/i,
	/\btask (?:is )?(?:complete|done|finished)\b/i,
	/\bsuccessfully (?:completed|implemented|applied|fixed|resolved|updated)\b/i,
];

/**
 * Evidence markers that, if present, make a completion claim substantiated.
 * A completion claim is only a violation if NONE of these are present.
 */
const EVIDENCE_MARKERS = [
	/^#{1,3}\s*ACTION\s+\d/m,
	/\bFile\(?s?\)?:\s*[`"']?[\w/.-]+/i,
	/\bCommand:\s*[`"']?.+/i,
	/\bEvidence:\s*.+/i,
	/\bVerified:\s*YES/i,
	/\bexit\s*(?:code)?:?\s*0\b/i,
	/\bpass\b.{0,20}\bfail\b/i,
	/\b\d+\s+pass/i,
	/```[\s\S]{10,}```/,
	/\b(?:output|result):\s*\n/i,
];

/**
 * Patterns indicating the user gave an explicit directive that must not be ignored.
 */
const DIRECTIVE_MARKERS = [
	/\byou (?:MUST|must|SHALL|shall) (?:NOT |not )?/i,
	/\bdo NOT\b/i,
	/\bNEVER\b/,
	/\bALWAYS\b/,
	/\bprohibited\b/i,
	/\bforbidden\b/i,
	/\brequired\b/i,
	/\bmandatory\b/i,
	/\binviolable\b/i,
];

// ============================================================================
// Detector Functions
// ============================================================================

/**
 * Detect unwanted questions in model output.
 *
 * A question is "unwanted" when the model asks for clarification, preference,
 * or permission in output text. This is a violation of the default-to-action
 * contract unless the user explicitly invited questions.
 */
function detectUnwantedQuestions(text: string, observationId: string): BehavioralViolation | undefined {
	for (const pattern of QUESTION_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			return {
				type: "unwanted_question",
				confidence: 0.75,
				description: "Model asked a clarifying/permission question instead of acting",
				evidence: match[0],
				enforcementAction:
					"Do not ask clarifying questions. Default to informed action. " +
					"Resolve ambiguity using repo context, existing patterns, and reasonable defaults. " +
					"Only ask when options have materially different tradeoffs the user must decide.",
				observationId,
			};
		}
	}
	return undefined;
}

/**
 * Detect completion claims without evidence.
 *
 * A completion claim is a violation when the model says work is done but
 * the same output does not contain evidence markers (file paths, command
 * output, test results, verification receipts).
 */
function detectUnsubstantiatedCompletion(text: string, observationId: string): BehavioralViolation | undefined {
	// Check if any completion claim pattern matches
	let claimMatch: RegExpMatchArray | null = null;
	for (const pattern of COMPLETION_CLAIM_PATTERNS) {
		claimMatch = text.match(pattern);
		if (claimMatch) break;
	}
	if (!claimMatch) return undefined;

	// Check if evidence markers are present
	for (const marker of EVIDENCE_MARKERS) {
		if (marker.test(text)) {
			return undefined; // Claim is substantiated
		}
	}

	return {
		type: "unsubstantiated_completion",
		confidence: 0.8,
		description: "Model claimed work is complete without showing evidence",
		evidence: claimMatch[0],
		enforcementAction:
			"Never declare work complete without evidence. Every completion claim must include: " +
			"(1) exact action taken with file:line, (2) command run and its output, " +
			"(3) verification result (test pass, type check, etc.). " +
			"If evidence cannot be provided, status must be INCOMPLETE.",
		observationId,
	};
}

/**
 * Detect ignored directives.
 *
 * This detector looks for observation pairs where:
 *   - A prior observation (user input to a tool) contains an explicit directive
 *   - A subsequent observation (model output) violates that directive
 *
 * For single-observation analysis, we check if the model output contains
 * both a directive echo and a contradicting action.
 */
function detectIgnoredDirective(
	text: string,
	observationId: string,
	priorDirectives: string[],
): BehavioralViolation | undefined {
	// Check if any prior directive from this session was violated
	for (const directive of priorDirectives) {
		const directiveLower = directive.toLowerCase();

		// "do NOT ask" + model asks a question
		if (directiveLower.includes("do not ask") || directiveLower.includes("must not ask")) {
			for (const qPattern of QUESTION_PATTERNS) {
				const match = text.match(qPattern);
				if (match) {
					return {
						type: "ignored_directive",
						confidence: 0.9,
						description: `Model asked "${match[0]}" despite directive: "${directive.slice(0, 80)}"`,
						evidence: match[0],
						enforcementAction:
							`User directive was: "${directive.slice(0, 120)}". ` +
							"This directive was violated. It must be followed exactly in all future interactions.",
						observationId,
					};
				}
			}
		}

		// "NEVER declare done without" + model declares done without
		if (directiveLower.includes("never") && directiveLower.includes("done")) {
			for (const cPattern of COMPLETION_CLAIM_PATTERNS) {
				if (cPattern.test(text)) {
					const hasEvidence = EVIDENCE_MARKERS.some(m => m.test(text));
					if (!hasEvidence) {
						return {
							type: "ignored_directive",
							confidence: 0.9,
							description: `Model claimed completion without evidence despite directive: "${directive.slice(0, 80)}"`,
							evidence: text.match(cPattern)![0],
							enforcementAction:
								`User directive was: "${directive.slice(0, 120)}". ` +
								"This directive was violated. Completion claims require evidence rows.",
							observationId,
						};
					}
				}
			}
		}
	}

	return undefined;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract explicit directives from observation text.
 * Returns directive sentences for tracking across a session.
 */
export function extractDirectives(text: string): string[] {
	const directives: string[] = [];
	// Split into sentences on period, exclamation, newline, or semicolon.
	// Also treat the full text as a candidate if no split occurs.
	const sentences = text.split(/[.!;]\s+|\n/).filter(s => s.length > 10);
	if (sentences.length === 0 && text.length > 10) {
		sentences.push(text);
	}
	for (const sentence of sentences) {
		for (const marker of DIRECTIVE_MARKERS) {
			if (marker.test(sentence)) {
				directives.push(sentence.trim().slice(0, 200));
				break;
			}
		}
	}
	return directives;
}

/**
 * Analyze a set of observations for behavioral violations.
 *
 * @param observations - Session observations to analyze
 * @returns Array of detected behavioral violations
 */
export function classifyBehavior(observations: Observation[]): BehavioralViolation[] {
	const violations: BehavioralViolation[] = [];
	const sessionDirectives: string[] = [];

	// Sort by timestamp for sequential analysis
	const sorted = [...observations].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

	for (const obs of sorted) {
		// Extract directives from user input (tool_start events often contain user intent)
		if (obs.input) {
			sessionDirectives.push(...extractDirectives(obs.input));
		}

		// Analyze model output text for violations
		const textToAnalyze = obs.output ?? obs.error ?? "";
		if (textToAnalyze.length < 20) continue;

		// Run all detectors
		const question = detectUnwantedQuestions(textToAnalyze, obs.id);
		if (question) violations.push(question);

		const completion = detectUnsubstantiatedCompletion(textToAnalyze, obs.id);
		if (completion) violations.push(completion);

		if (sessionDirectives.length > 0) {
			const directive = detectIgnoredDirective(textToAnalyze, obs.id, sessionDirectives);
			if (directive) violations.push(directive);
		}
	}

	return violations;
}
