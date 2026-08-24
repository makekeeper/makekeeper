import { Injectable, Logger } from '@nestjs/common';
import { PluginConfigService } from './plugin-config.service';
import { getErrorMessage } from './error';

export type PluginEventHandler<T> = (payload: T) => Promise<void> | void;

interface RegisteredListener {
  pluginId: string;
  handler: PluginEventHandler<unknown>;
}

// Fire-and-forget domain events between plugins (#58): the emitter announces a
// fact about its own domain; listening plugins react to it. Listeners register
// in `onModuleInit()`; `emit` skips listeners whose plugin is disabled (checked
// per emission — enablement flips at runtime) and never lets a listener error
// escape into the emitter's flow. Event names + payload shapes live in
// plugin-contract's capabilities.ts.
@Injectable()
export class PluginEventBusService {
  private readonly logger = new Logger(PluginEventBusService.name);
  private readonly listeners = new Map<string, RegisteredListener[]>();

  constructor(private readonly pluginConfig: PluginConfigService) {}

  on<T>(pluginId: string, event: string, handler: PluginEventHandler<T>): void {
    const list = this.listeners.get(event) ?? [];
    // Handlers are stored untyped; the event name IS the payload contract
    // (bound in plugin-contract), so the narrowing cannot be a guard.
    list.push({ pluginId, handler: handler as PluginEventHandler<unknown> });
    this.listeners.set(event, list);
  }

  // Awaits every enabled listener sequentially so an emitter that needs the
  // side effects applied before responding (e.g. stock written before the UI
  // refetches) can simply await the emission. Listener errors are logged and
  // swallowed — a broken listener must never fail the emitting flow.
  async emit<T>(event: string, payload: T): Promise<void> {
    const list = this.listeners.get(event) ?? [];
    for (const listener of list) {
      if (!this.pluginConfig.isEnabled(listener.pluginId)) continue;
      try {
        await listener.handler(payload);
      } catch (err) {
        this.logger.error(
          `Listener of plugin "${listener.pluginId}" failed for event "${event}": ${getErrorMessage(err)}`,
        );
      }
    }
  }
}
