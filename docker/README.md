# Docker images

Everything runs through `bin/mfs`, which runs the harness in one of these images.

| image | Dockerfile | contents | used for |
| --- | --- | --- | --- |
| `mfs-base` | `base/Dockerfile` | Node 24, TypeScript, Chromium, rustc, clang, GDAL, osmium, DuckDB 1.5.5, laspy | the harness, every bake step, every renderer that needs nothing more |
| `mfs-emscripten` | `Dockerfile.emscripten` | `mfs-base` plus Emscripten 6.0.13 (emcc, clang/wasm-ld, binaryen, prebuilt sysroot) | C/C++ to wasm32, including JSPI builds |

## Toolchain images

Experimental browser technologies sometimes need a compiler that the base image does not need. Each of those compilers gets its own image, `docker/Dockerfile.<toolchain>`, so the base image stays the size every example pays for.

```sh
bin/mfs image emscripten                     # build mfs-emscripten:latest (builds mfs-base first if missing)
MFS_TOOLCHAIN=emscripten bin/mfs test        # also runs harness/test/emscripten.test.ts
MFS_TOOLCHAIN=emscripten bin/mfs build <id>  # an example whose build calls emcc
```

`MFS_TOOLCHAIN=<toolchain>` selects `mfs-<toolchain>:latest` and builds it when it is missing. Every other command works in it as in the base image, because a toolchain image is the base image with one compiler added.

An example states the toolchain its build needs in `spec.yaml`:

```yaml
architecture_selection:
  chosen:
    toolchain: emscripten
    build: [emcc, -O2, -sJSPI, examples/xx/reader.c, -o, examples/xx/reader.js]
```

The image sets `MFS_TOOLCHAIN` to its own name. `bin/mfs build <id>` stops and says which command to use when the running image is another one. `bin/mfs build all` skips that example and names it. Bench and the Pages site build need only the build output, which stays in the base image: build first, then bench or run `tools/deploy-pages.sh`.

## Emscripten

- Version: Emscripten 6.0.13, copied from `emscripten/emsdk:6.0.13`, pinned by digest in `Dockerfile.emscripten`. To upgrade, change the tag and digest together.
- Emscripten's own Node is not copied. Node 24 from the base image runs the output, and it supports JSPI (`WebAssembly.Suspending`) without flags. So does the base image's Chromium 156.
- The sysroot cache comes prebuilt and frozen (`EM_FROZEN_CACHE=1`). emcc never downloads a port or writes into the image while it runs, so a build is the same with or without network. A build that needs a library the cache lacks fails instead of fetching it.
- `harness/test/emscripten.test.ts` is the check that the image works. It builds `harness/test/fixtures/emscripten/hello.c`, and `jspi.c`, in which C reads byte ranges through an async JS function. The JSPI build runs in Node and in the harness's Chromium, and the same C built without `-sJSPI` fails, which shows the suspension is JSPI's doing. It passes with `docker run --network none`.

## Adding a toolchain

Add one only when an example needs it, not ahead of time.

1. Write `docker/Dockerfile.<toolchain>` starting with `ARG BASE=mfs-base:latest` and `FROM ${BASE}`, pin the versions it installs, and set `ENV MFS_TOOLCHAIN=<toolchain>`.
2. Install everything at image build time, so a build does not reach the network.
3. Add `harness/test/<toolchain>.test.ts`, skipped unless `MFS_TOOLCHAIN` is that toolchain, building and running the smallest program that needs it.
4. Add a row to the table above.
