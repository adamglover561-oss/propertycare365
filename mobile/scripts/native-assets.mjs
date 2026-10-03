import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const exists=async path=>{try{await access(path);return true;}catch{return false;}};

const icon=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<rect width="1024" height="1024" rx="220" fill="#08111f"/>
<rect x="118" y="118" width="788" height="788" rx="210" fill="#47b9ff"/>
<path d="M274 493 512 300l238 193v226c0 32-26 58-58 58H332c-32 0-58-26-58-58V493Z" fill="#08111f"/>
<path d="M366 676V526h292v150" fill="none" stroke="#47b9ff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
<text x="512" y="615" text-anchor="middle" font-family="Arial,sans-serif" font-size="168" font-weight="900" fill="#f7f9fc">365</text>
</svg>`);

await mkdir('assets',{recursive:true});
await sharp(icon).png().toFile('assets/store-icon.png');

if(await exists('ios/App/App/Assets.xcassets/AppIcon.appiconset')){
  await sharp(icon).resize(1024,1024).png().toFile('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
}

if(await exists('android/app/src/main/res')){
  for(const [density,size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})){
    const dir=`android/app/src/main/res/mipmap-${density}`;
    if(!(await exists(dir)))continue;
    for(const name of ['ic_launcher','ic_launcher_round']){
      await sharp(icon).resize(size,size).png().toFile(`${dir}/${name}.png`);
    }
    await sharp(icon).resize(Math.round(size*2.25),Math.round(size*2.25)).png().toFile(`${dir}/ic_launcher_foreground.png`);
  }
  for(const path of ['android/app/src/main/res/drawable/ic_launcher_background.xml','android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml']){
    if(!(await exists(path)))continue;
    const contents=await readFile(path,'utf8');
    await writeFile(path,contents.replace(/#FFFFFF/g,'#08111f'));
  }
}
