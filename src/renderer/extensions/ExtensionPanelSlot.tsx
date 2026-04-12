import React from "react";
import type { DashboardEmail } from "../../shared/types";
import type { ExtensionEnrichmentResult } from "../../shared/extension-types";

// Panel component registry - populated by bundled extensions
// Maps "extensionId:panelId" -> React component
export type PanelComponentProps = {
  email: DashboardEmail;
  threadEmails: DashboardEmail[];
  enrichment: ExtensionEnrichmentResult | null;
  isLoading: boolean;
};

type PanelComponent = React.ComponentType<PanelComponentProps>;

const panelComponentRegistry = new Map<string, PanelComponent>();

// Listeners notified when the registry changes (component registered/unregistered).
// This lets the useExtensionPanels hook re-render when components become available
// (e.g. async startup loading, mid-session install).
const registryListeners = new Set<() => void>();

export function onRegistryChange(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

function notifyRegistryListeners(): void {
  for (const listener of registryListeners) listener();
}

/**
 * Register a panel component for an extension
 */
export function registerPanelComponent(
  extensionId: string,
  panelId: string,
  component: PanelComponent,
): void {
  const key = `${extensionId}:${panelId}`;
  panelComponentRegistry.set(key, component);
  notifyRegistryListeners();
}

/**
 * Unregister all panel components for an extension (used on uninstall)
 */
export function unregisterExtensionPanels(extensionId: string): void {
  for (const key of [...panelComponentRegistry.keys()]) {
    if (key.startsWith(`${extensionId}:`)) {
      panelComponentRegistry.delete(key);
    }
  }
  notifyRegistryListeners();
}

/**
 * Get a registered panel component
 */
export function getPanelComponent(extensionId: string, panelId: string): PanelComponent | null {
  const key = `${extensionId}:${panelId}`;
  return panelComponentRegistry.get(key) ?? null;
}

interface ExtensionPanelSlotProps {
  extensionId: string;
  panelId: string;
  title: string;
  email: DashboardEmail;
  threadEmails: DashboardEmail[];
  enrichment: ExtensionEnrichmentResult | null;
  isLoading: boolean;
  isFirst?: boolean;
}

/**
 * Renders a single extension panel with its header
 */
export function ExtensionPanelSlot({
  extensionId,
  panelId,
  title,
  email,
  threadEmails,
  enrichment,
  isLoading,
  isFirst = false,
}: ExtensionPanelSlotProps): React.ReactElement | null {
  const Component = getPanelComponent(extensionId, panelId);

  if (!Component) {
    console.warn(`[Extensions] No component registered for panel ${extensionId}:${panelId}`);
    return null;
  }

  return (
    <div
      className={`flex flex-col overflow-hidden ${!isFirst ? "border-t exo-border-subtle" : ""}`}
    >
      <div className="px-4 py-3 border-b exo-border-subtle exo-surface-soft">
        <h3 className="text-xs font-semibold exo-text-muted uppercase tracking-wide exo-micro-label">
          {title}
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Component
          email={email}
          threadEmails={threadEmails}
          enrichment={enrichment}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

/**
 * Loading placeholder for panels
 */
export function ExtensionPanelLoading(): React.ReactElement {
  return (
    <div className="flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b exo-border-subtle exo-surface-soft">
        <div className="h-3 bg-[var(--exo-border-subtle)] rounded animate-pulse w-16" />
      </div>
      <div className="flex-1 p-4">
        <div className="space-y-3">
          <div className="h-12 bg-[var(--exo-bg-surface-soft)] rounded animate-pulse" />
          <div className="h-4 bg-[var(--exo-bg-surface-soft)] rounded animate-pulse w-3/4" />
          <div className="h-4 bg-[var(--exo-bg-surface-soft)] rounded animate-pulse w-1/2" />
        </div>
      </div>
    </div>
  );
}
