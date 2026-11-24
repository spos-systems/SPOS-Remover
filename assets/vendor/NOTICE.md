# NOTICE — vendored third-party runtime engine

This directory contains **pre-bundled runtime code vendored into this repository
so the tool has ZERO runtime dependency on any external CDN** (a hard
reliability requirement for networks where public CDNs are blocked or
unstable).

| File | Upstream package | Upstream license | Source of this bundle |
| --- | --- | --- | --- |
| `background-removal.mjs` | [`@imgly/background-removal@1.7.0`](https://github.com/imgly/background-removal-js) | **AGPL-3.0** — see [`LICENSE.md`](./LICENSE.md) (full text included here) | jsDelivr ESM bundle of the package's `dist/index.mjs`, with the two `onnxruntime-web` import specifiers rewritten to the local `./ort.mjs` / `./ort-webgpu.mjs` files below (no functional change) |
| `ort.mjs` | [`onnxruntime-web@1.21.0`](https://github.com/microsoft/onnxruntime) (MIT) | MIT | jsDelivr ESM bundle |
| `ort-webgpu.mjs` | [`onnxruntime-web@1.21.0` webgpu build](https://github.com/microsoft/onnxruntime) (MIT) | MIT | jsDelivr ESM bundle |

## Licensing implications

- The project's own code is MIT (see repository root `LICENSE`).
- The files in this directory are **AGPL-3.0 / MIT as noted above and keep
  their upstream licenses**. The deployed web application, as a combined work
  distributed over a network, is subject to the terms of AGPL-3.0 for the
  vendored `background-removal.mjs` component. Complete corresponding source
  for the combined work is exactly this public repository.
- Onnx runtime model weights (`assets/models/`) are served from the upstream
  IMG.LY data package for the tiers `isnet_fp16` / `isnet`, and self-hosted
  for the default `isnet_quint8` tier.

## Why vendoring

Before this change the library was imported at runtime from
`cdn.jsdelivr.net` / `esm.sh`. On networks where those hosts are blocked the
AI background removal failed with "model failed to load" even though the site
itself loaded fine. Vendoring guarantees: **if the page opens, the engine is
already here.**
