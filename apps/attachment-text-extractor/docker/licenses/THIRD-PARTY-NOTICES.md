# Third-party notices for the PDFium WebAssembly binary

The image ships `@embedpdf/pdfium` 2.15.1, whose `dist/pdfium.wasm` is a build of
PDFium that statically links the libraries below. The npm package carries only its
own `LICENSE` (MIT) and `LICENSE.pdfium` (PDFium: BSD-3-Clause and Apache-2.0), so
the notices of the bundled libraries are kept here and copied to `/licenses/` in the
image, next to those two files.

## Acknowledgements required by the licences

- This software is based in part on the work of the Independent JPEG Group.
- Portions of this software are copyright © 2026 The FreeType Project
  (www.freetype.org). All rights reserved.

## Where the list comes from

`dist/pdfium.wasm` of the npm package is byte-identical to
`packages/pdfium/src/vendor/pdfium.wasm` on the `v2` branch of
https://github.com/embedpdf/embed-pdf-viewer (git blob
`9af0377bd26230ec397c7e418e9a9df38eb43d8f`). That branch builds it from:

- the PDFium fork https://github.com/embedpdf/pdfium at commit
  `73a041a5c1aaffa09ebb64f1981ff501cb91a41c` (the `packages/pdfium/pdfium-src`
  submodule), whose `DEPS` file pins the revisions named below;
- `packages/pdfium/scripts/build.sh`: `pdf_enable_xfa=false`, `pdf_enable_v8=false`,
  `pdf_use_skia=false`, `pdf_use_partition_alloc=false`, `use_custom_libcxx=false`,
  `pdf_is_complete_lib=true`;
- `packages/pdfium/Dockerfile` and `build/compile.sh`: Emscripten 3.1.70
  (`emscripten/emsdk:3.1.70`), which links its own C and C++ runtime.

The list is every third-party library that the `pdfium` target depends on in that
configuration (read from the fork's `BUILD.gn` files). It is deliberately a superset:
the linker may have dropped a library that no remaining code calls (no string of
abseil or ICU is left in the binary), and a notice for an absent library is harmless.

## Files

| Directory | Library | Licence | Taken from |
|---|---|---|---|
| `pdfium-wasm/freetype/` | FreeType | FreeType License (FTL), chosen from FTL / GPLv2 | `FTL.TXT`: fork, `third_party/freetype/`. `LICENSE.TXT`: chromium.googlesource.com `chromium/src/third_party/freetype2` @ `b91f75bd02db43b06d634591eb286d3eb0ce3b65` |
| `pdfium-wasm/libjpeg-turbo/` | libjpeg-turbo | IJG, BSD-3-Clause, zlib | `chromium/deps/libjpeg_turbo` @ `6bb85251a8382b5e07f635a981ac685cc5ab5053` |
| `pdfium-wasm/libopenjpeg/` | OpenJPEG | BSD-2-Clause | fork, `third_party/libopenjpeg/LICENSE` |
| `pdfium-wasm/libpng/` | libpng | PNG Reference Library License v2 | `chromium/src/third_party/libpng` @ `172f83835c98264e6eefdbe8ae82dc08be337ad0` |
| `pdfium-wasm/zlib/` | zlib | zlib | `chromium/src/third_party/zlib` @ `980253c1cc835c893c57b5cfc10c5b942e10bc46` |
| `pdfium-wasm/lcms/` | Little CMS | MIT | fork, `third_party/lcms/LICENSE` |
| `pdfium-wasm/agg23/` | Anti-Grain Geometry 2.3 | AGG 2.3 permissive notice | fork, `third_party/agg23/copying` |
| `pdfium-wasm/fast_float/` | fast_float | Apache-2.0, MIT or BSL-1.0 | `external/github.com/fastfloat/fast_float` @ `cb1d42aaa1e14b09e1452cfdef373d051b8c02a4` |
| `pdfium-wasm/abseil-cpp/` | Abseil | Apache-2.0 | `chromium/src/third_party/abseil-cpp` @ `675d3d37ecbec78fd51378c6774c45715b1e4382` |
| `pdfium-wasm/icu/` | ICU | Unicode License v3 and the licences it lists | `chromium/deps/icu` @ `a86a32e67b8d1384b33f8fa48c83a6079b86f8cd` |
| `pdfium-wasm/emscripten/` | Emscripten runtime: musl libc, libc++, libc++abi, compiler-rt | MIT or NCSA (Emscripten), MIT (musl), Apache-2.0 with LLVM exceptions | https://github.com/emscripten-core/emscripten tag `3.1.70`: `LICENSE`, `system/lib/libc/musl/COPYRIGHT`, `system/lib/{libcxx,libcxxabi,compiler-rt}/LICENSE.TXT` |

The files are unmodified copies. When `@embedpdf/pdfium` is upgraded, redo this list
from the new build inputs.
