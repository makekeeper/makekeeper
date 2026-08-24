export * from './lib/registry';
export * from './lib/contributions';
export * from './lib/navigation';
export * from './lib/use-camera-scanner';
export * from './lib/offline-queue';
export * from './lib/i18n';
export * from './lib/plugins-store';
export * from './lib/preferences-store';
export * from './lib/api';
export * from './lib/sanitize-html';
export * from './lib/errors';
export * from './lib/tree-options';
export * from './lib/field-value';
export * from './lib/session-store';
export * from './lib/providers-events';
export * from './lib/data-events';
export * from './lib/use-resource';
export * from './lib/use-route-query';
export * from './lib/use-reactivated';
export * from './lib/use-page-context';
export * from './lib/realtime';
export {
  useAvailabilityStore,
  type BackendAvailability,
} from './lib/availability-store';
export * from './lib/chat-events';
export * from './lib/page-context';
export * from './lib/plugin-icons';
export * from './lib/clipboard';
export { default as CopyField } from './lib/components/CopyField.vue';
export { default as Select } from './lib/components/Select.vue';
export { default as RichEditor } from './lib/components/RichEditor.vue';
export { default as MarkdownMessage } from './lib/components/MarkdownMessage.vue';
export { default as Button } from './lib/components/Button.vue';
export type { BadgeTone } from './lib/components/Badge.vue';
export { default as Badge } from './lib/components/Badge.vue';
export { default as Tooltip } from './lib/components/Tooltip.vue';
export { default as TagInput } from './lib/components/TagInput.vue';
export { default as Switch } from './lib/components/Switch.vue';
export { default as TimePicker } from './lib/components/TimePicker.vue';
export { default as Checkbox } from './lib/components/Checkbox.vue';
export { default as SegmentedControl } from './lib/components/SegmentedControl.vue';
export type { SegmentedOption } from './lib/components/SegmentedControl.vue';
export { default as SecretInput } from './lib/components/SecretInput.vue';
export { secretPatch, type SecretAction } from './lib/secret-field';
export { default as Spinner } from './lib/components/Spinner.vue';
export { default as Refreshable } from './lib/components/Refreshable.vue';
export { default as Modal } from './lib/components/Modal.vue';
export { default as Disclosure } from './lib/components/Disclosure.vue';
export { default as ResizeHandle } from './lib/components/ResizeHandle.vue';
// Moved out of plugin-projects in #213: inventory items carry a set of
// photographs now, and a plugin may not import another plugin's component.
export { default as ImageLightbox } from './lib/components/ImageLightbox.vue';
export type { LightboxImage } from './lib/components/ImageLightbox.vue';
export { default as PhotoGallery } from './lib/components/PhotoGallery.vue';
export type { GalleryPhoto } from './lib/components/PhotoGallery.vue';
export { default as PageHeader } from './lib/components/PageHeader.vue';
export { default as BackLink } from './lib/components/BackLink.vue';
export * from './lib/mobile-screen-chrome';
export * from './lib/pinch-zoom';
export { default as PageTabs } from './lib/components/PageTabs.vue';
export type { PageTabItem } from './lib/components/PageTabs.vue';
export { default as AnchoredPopover } from './lib/components/AnchoredPopover.vue';
export { default as HubLayout } from './lib/components/HubLayout.vue';
export { default as SectionNav } from './lib/components/SectionNav.vue';
export type { SectionNavItem } from './lib/components/SectionNav.vue';
export { default as PluginSlot } from './lib/components/PluginSlot.vue';
export { default as PhoneBridgeModal } from './lib/components/PhoneBridgeModal.vue';
export { default as EmptyState } from './lib/components/EmptyState.vue';
export { default as BrandMark } from './lib/components/BrandMark.vue';
export * from './lib/brand-mark';
export { default as QrCode } from './lib/components/QrCode.vue';
export { default as CopyableLink } from './lib/components/CopyableLink.vue';
export * from './lib/qr-code';
export { default as DashboardStatCard } from './lib/components/DashboardStatCard.vue';
export { default as DashboardAction } from './lib/components/DashboardAction.vue';
export { default as ContributionHeatmap } from './lib/components/ContributionHeatmap.vue';
export type { HeatmapDay } from './lib/components/ContributionHeatmap.vue';
export { default as DonutChart } from './lib/components/DonutChart.vue';
export type { DonutSegment } from './lib/components/DonutChart.vue';
export { default as SparkAreaChart } from './lib/components/SparkAreaChart.vue';
export type {
  SparkPoint,
  SparkSeries,
} from './lib/components/SparkAreaChart.vue';
export { default as ToastViewport } from './lib/components/ToastViewport.vue';
export { default as OfflineOverlay } from './lib/components/OfflineOverlay.vue';
export { default as BusyOverlay } from './lib/components/BusyOverlay.vue';
export { default as ConfirmDialog } from './lib/components/ConfirmDialog.vue';
export { useToastStore, type Toast, type ToastTone } from './lib/toast-store';
export {
  useConfirm,
  useConfirmStore,
  type ConfirmOptions,
} from './lib/confirm-store';
export { useVersionStore } from './lib/version-store';
export {
  useInternalDragStore,
  type InternalDragFile,
} from './lib/internal-drag-store';
export { asciiFilename } from './lib/filename';
export { renderMarkdown } from './lib/components/markdown';
export { readAsDataUrl } from './lib/image-file';
export { previewUrl, prewarmPreviews } from './lib/preview-url';
