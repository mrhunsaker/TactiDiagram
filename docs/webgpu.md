# WebGPU setup and browser compatibility

TactiDiagram's optional **SAM 2.1 Hiera Tiny** segmentation backend uses ONNX Runtime Web with the WebGPU execution provider. WebGPU availability in a browser is necessary, but not sufficient: the browser, operating system, GPU adapter, driver, and ONNX Runtime's supported shader operations must all work together.

The default **SlimSAM** backend uses WebAssembly (WASM), not WebGPU. It remains the reliable choice when SAM 2.1 is unavailable or fails.

## Browser compatibility in TactiDiagram

| Browser | TactiDiagram application | SAM 2.1 WebGPU option |
|---|---|---|
| Google Chrome (desktop) | Recommended | Supported when WebGPU and a compatible hardware adapter are available. |
| Microsoft Edge (desktop) | Recommended | Supported when WebGPU and a compatible hardware adapter are available. |
| Brave, Chromium, Vivaldi, Opera | Chromium-based; not all variants are tested | May work when the browser exposes a compatible WebGPU adapter and ONNX Runtime works. Chrome/Edge instructions below are similar, but vendor-specific behavior can differ. |
| Firefox | The standard app and SlimSAM work | TactiDiagram deliberately gates SAM 2.1 off in Firefox. Firefox's WebGPU API support does not remove the current ONNX Runtime compatibility issue. The app uses SlimSAM instead. |
| Safari and WebKit-based browsers | Not a supported TactiDiagram target | Do not use these browsers for SAM 2.1 in this application. Safari's browser-level WebGPU support does not imply that this application's model/runtime combination is supported. |
| Neutralino desktop window on Windows | Uses Microsoft Edge WebView2 | May use SAM 2.1 if the installed WebView2 runtime and GPU expose a compatible adapter. |
| Neutralino desktop window on Linux | Uses system WebKitGTK | Not a supported SAM 2.1 target; use the browser application in Chrome or Edge instead. |

Browser-level support changes by operating system and release. For example, Firefox WebGPU has shipped on Windows and Apple-silicon Macs, while other Firefox platforms remain limited. TactiDiagram nevertheless disables SAM 2.1 on Firefox because the current ONNX Runtime WebGPU execution path can fail while compiling or running model operators. See [Chrome's browser support overview](https://developer.chrome.com/docs/web-platform/webgpu/overview), [Mozilla's Firefox WebGPU status](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Experimental_features#webgpu_api), and the [WebGPU implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status).

## Chrome setup

1. Update Chrome to the latest stable release.
2. Open `chrome://settings/system`.
3. Enable **Use graphics acceleration when available**.
4. Select **Relaunch**.
5. Open `chrome://gpu` and inspect **Graphics Feature Status**. Confirm WebGPU is available and hardware acceleration is active. A software-only or unavailable status usually indicates a driver, adapter, platform, or policy limitation.
6. Open TactiDiagram from its local server at `http://localhost:5173` or from an HTTPS deployment. Do not open the application HTML directly with a `file://` URL.
7. Run an analysis with **Use experimental SAM 2.1 segmentation (WebGPU)** checked. If the application reports a fallback to SlimSAM, leave the option off unless the underlying browser/driver issue is resolved.

## Microsoft Edge setup

1. Update Edge to the latest stable release.
2. Open `edge://settings/system` (in some versions this appears under **System and performance**).
3. Enable **Use graphics acceleration when available**.
4. Select **Restart**.
5. Open `edge://gpu` and inspect the graphics feature status for WebGPU and hardware acceleration.
6. Open TactiDiagram through `http://localhost:5173` or HTTPS, then try the SAM 2.1 option.

## Brave and other Chromium browsers

Update the browser, find its **System** or **System and performance** settings, enable hardware/graphics acceleration, and restart it. Use the browser's internal GPU page when available (for example, `brave://gpu` or `vivaldi://gpu`). Chromium ancestry alone does not guarantee that a particular build, Linux GPU backend, or managed-browser policy supports the ONNX Runtime operations used by SAM 2.1.

## Firefox

Firefox has its own WebGPU implementation on some platforms, but TactiDiagram currently detects Firefox and bypasses SAM 2.1. This is intentional: the ONNX Runtime WebGPU backend used by this application is not currently reliable with the Firefox implementation and can fail during model execution even when a WebGPU adapter is visible.

- Use Firefox with the default SlimSAM/WASM backend.
- You do not need to change `about:config` or enable Firefox WebGPU flags for TactiDiagram.
- Checking the SAM 2.1 option does not make this backend available in Firefox; the loader reports the incompatibility and selects SlimSAM.

## Operating-system and GPU requirements

- **Windows:** use a current graphics driver from Intel, AMD, or NVIDIA. Chromium WebGPU generally relies on Direct3D 12. Managed-device policies, remote desktop sessions, virtual machines, and disabled hardware acceleration can prevent adapter access.
- **macOS:** use a current supported macOS release and GPU. Chrome/Edge are the recommended route for this application. Firefox's macOS WebGPU availability is limited by macOS version and Apple Silicon, and TactiDiagram still gates Firefox off.
- **Linux:** WebGPU availability varies substantially by browser version, GPU generation, Vulkan/driver stack, and distribution. A browser may run the rest of TactiDiagram while lacking a usable WebGPU adapter. Check `chrome://gpu` or `edge://gpu`; do not assume that enabling a flag will make an unsupported GPU/runtime combination work.
- **Hardware acceleration:** update the GPU driver and restart the browser after changing acceleration settings. Software rendering is not a reliable substitute for SAM 2.1 inference.

The application uses `navigator.gpu.requestAdapter()` to check for a usable adapter. An adapter can still be returned even if a later ONNX shader/operator cannot compile or execute. Therefore, a successful browser capability check is only a preliminary check, not a guarantee that SAM 2.1 inference will complete.

## TactiDiagram fallback behavior

SAM 2.1 is optional and off by default. When selected:

1. The application checks for the WebGPU API and a usable adapter.
2. Firefox, missing WebGPU, or a missing adapter selects SlimSAM immediately and records the reason.
3. If SAM 2.1 model initialization fails, the loader selects SlimSAM.
4. If SAM 2.1 inference fails after some labels have been processed, the pipeline discards partial SAM 2.1 masks, clears the label masks, and reruns the complete segmentation set with SlimSAM.
5. The UI reports the fallback and unchecks the SAM 2.1 option.

A completed analysis after fallback is a SlimSAM result, not a SAM 2.1 result. Check the displayed backend/status message before comparing model output.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| WebGPU is unavailable in `chrome://gpu` or `edge://gpu` | Hardware acceleration off, unsupported platform/GPU, driver issue, browser policy | Enable acceleration, restart, update the GPU driver, and recheck. |
| `navigator.gpu` is missing or no adapter is returned | Insecure origin, unsupported platform, blocked GPU, remote/virtual session | Use localhost or HTTPS; check the browser GPU page and driver. |
| Adapter is available but SAM 2.1 falls back | ONNX Runtime model initialization or operator/shader failure | Use the fallback SlimSAM result; record browser/OS/GPU details for a reproducible bug report. |
| Firefox reports a fallback | Expected application behavior | Use SlimSAM in Firefox; switching Firefox flags will not bypass the application's compatibility gate. |
| Linux Chrome/Edge exposes no adapter | Platform rollout, Vulkan/driver, GPU-generation, or distribution limitation | Try a current supported Chromium build and driver; otherwise use SlimSAM. |
| Analysis stalls or the GPU process resets | Driver/device loss or runtime failure | Restart the browser and retry with SAM 2.1 off. |

Chrome's official [WebGPU troubleshooting guide](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) describes secure-context requirements, hardware acceleration, adapter availability, and GPU diagnostics. Avoid enabling experimental `chrome://flags` overrides as a routine fix; they do not make an unsupported ONNX Runtime/browser combination reliable.

## Scope

WebGPU is used for the optional SAM 2.1 segmentation backend. OCR and default SlimSAM inference use the project's WASM paths. WebGL is a separate browser API used for the 3D relief preview and STL export; a WebGL problem does not by itself diagnose WebGPU support.
