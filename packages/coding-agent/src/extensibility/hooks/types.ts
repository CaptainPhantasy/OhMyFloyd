/**
 * Legacy hook types. These aliases preserve the old @oh-my-pi/pi-coding-agent/hooks
 * API while forwarding the actual implementation to the extension system.
 */

import type { HookMessage as SessionHookMessage } from "../../session/messages";
import type {
	AgentEndEvent,
	AgentStartEvent,
	AutoCompactionEndEvent,
	AutoCompactionStartEvent,
	AutoRetryEndEvent,
	AutoRetryStartEvent,
	BashToolResultEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	CustomToolResultEvent,
	EditToolResultEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionError,
	ExtensionFactory,
	ExtensionHandler,
	ExtensionUIContext,
	FindToolResultEvent,
	GrepToolResultEvent,
	MessageRenderer,
	ReadToolResultEvent,
	RegisteredCommand,
	SessionBeforeBranchEvent,
	SessionBeforeBranchResult,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionBeforeSwitchEvent,
	SessionBeforeSwitchResult,
	SessionBeforeTreeEvent,
	SessionBeforeTreeResult,
	SessionBranchEvent,
	SessionCompactEvent,
	SessionCompactingEvent,
	SessionCompactingResult,
	SessionEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionSwitchEvent,
	SessionTreeEvent,
	TodoReminderEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	TreePreparation,
	TtsrTriggeredEvent,
	TurnEndEvent,
	TurnStartEvent,
	WriteToolResultEvent,
} from "../extensions/types";

export type { ExecOptions, ExecResult } from "../../exec/exec";
export type { CustomMessage } from "../../session/messages";

export type HookMessage<T = unknown> = SessionHookMessage<T>;

export type HookUIContext = ExtensionUIContext;
export type HookContext = ExtensionContext;
export type HookCommandContext = ExtensionCommandContext;
export type HookAPI = ExtensionAPI;
export type HookHandler<E, R = undefined> = ExtensionHandler<E, R>;
export type HookMessageRenderer<T = unknown> = MessageRenderer<T>;
export type HookFactory = ExtensionFactory;
export type HookError = ExtensionError;

export type {
	AgentEndEvent,
	AgentStartEvent,
	AutoCompactionEndEvent,
	AutoCompactionStartEvent,
	AutoRetryEndEvent,
	AutoRetryStartEvent,
	BashToolResultEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	CustomToolResultEvent,
	EditToolResultEvent,
	FindToolResultEvent,
	GrepToolResultEvent,
	ReadToolResultEvent,
	RegisteredCommand,
	SessionBeforeBranchEvent,
	SessionBeforeBranchResult,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionBeforeSwitchEvent,
	SessionBeforeSwitchResult,
	SessionBeforeTreeEvent,
	SessionBeforeTreeResult,
	SessionBranchEvent,
	SessionCompactEvent,
	SessionCompactingEvent,
	SessionCompactingResult,
	SessionEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionSwitchEvent,
	SessionTreeEvent,
	TodoReminderEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	TreePreparation,
	TtsrTriggeredEvent,
	TurnEndEvent,
	TurnStartEvent,
	WriteToolResultEvent,
};
