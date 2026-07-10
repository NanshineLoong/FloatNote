// Re-export root so existing `import ... from "../preview"` / `"./preview"`
// paths keep resolving after the module was split into icons/widgets/builder.
export { livePreview, previewField, rangeTouchesSelection } from "./builder";
export { setNoteDir } from "./widgets";
export { iconCacheStateKey, shouldRetryMissingIcon } from "./icons";
export { attachImageToolbar } from "../image-toolbar";
