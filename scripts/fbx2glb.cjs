const assimpjs = require('assimpjs');
const fs = require('fs');
const path = require('path');
const [src, out] = process.argv.slice(2);
assimpjs().then((ajs) => {
  const files = new ajs.FileList();
  const dir = path.dirname(src);
  files.AddFile(path.basename(src), fs.readFileSync(src));
  for (const f of fs.readdirSync(dir)) if (/\.(jpe?g|png)$/i.test(f)) files.AddFile(f, fs.readFileSync(path.join(dir, f)));
  const res = ajs.ConvertFileList(files, 'glb2');
  if (!res.IsSuccess() || res.FileCount() === 0) { console.log('échec', res.GetErrorCode()); return; }
  fs.writeFileSync(out, Buffer.from(res.GetFile(0).GetContent()));
  console.log('ok', out, res.FileCount());
});
