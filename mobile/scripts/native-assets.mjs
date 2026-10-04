import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const exists=async path=>{try{await access(path);return true;}catch{return false;}};

const icon=await readFile('../public/icon.svg');

await mkdir('assets',{recursive:true});
await sharp(icon).resize(1024,1024).flatten({background:'#08111f'}).png().toFile('assets/store-icon.png');

if(await exists('ios/App/App/Assets.xcassets/AppIcon.appiconset')){
  await sharp(icon).resize(1024,1024).flatten({background:'#08111f'}).png().toFile('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
}

if(await exists('android/app/src/main/res')){
  for(const [density,size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})){
    const dir=`android/app/src/main/res/mipmap-${density}`;
    if(!(await exists(dir)))continue;
    for(const name of ['ic_launcher','ic_launcher_round']){
      await sharp(icon).resize(size,size).flatten({background:'#08111f'}).png().toFile(`${dir}/${name}.png`);
    }
    await sharp(icon).resize(Math.round(size*2.25),Math.round(size*2.25)).flatten({background:'#08111f'}).png().toFile(`${dir}/ic_launcher_foreground.png`);
  }
  for(const path of ['android/app/src/main/res/drawable/ic_launcher_background.xml','android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml']){
    if(!(await exists(path)))continue;
    const contents=await readFile(path,'utf8');
    await writeFile(path,contents.replace(/#FFFFFF/g,'#08111f'));
  }
}
