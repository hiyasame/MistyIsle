/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_WS_BASE_URL: string
  readonly VITE_SRS_BASE_URL: string
  readonly VITE_CDN_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
