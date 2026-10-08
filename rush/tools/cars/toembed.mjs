// GLB -> {"glb": base64} JSON with meshopt decoded, for a host that serves only JSON and may refuse WebAssembly and
// data: URL fetches. Quantized attributes stay (three reads KHR_mesh_quantization natively).
//   node toembed.mjs <in.glb> <out.json>
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
const glb = await io.writeBinary(doc);
fs.writeFileSync(process.argv[3], JSON.stringify({ glb: Buffer.from(glb).toString('base64') }));
console.log(process.argv[3].split('/').pop(), glb.byteLength, fs.statSync(process.argv[3]).size);
