import "server-only";
import {lstatSync,realpathSync} from "node:fs";
import path from "node:path";

export type LocalDecisionPreviewV7={releaseDirectory:string;activeLink:string;healthFile:string;origin:string};
const loopbackHosts=new Set(["localhost","127.0.0.1","[::1]"]);
function safeLocalDirectoryV7(directory:string,uid:number):boolean {
  if(!path.isAbsolute(directory)||path.resolve(directory)!==directory||realpathSync(directory)!==directory)return false;
  for(let current=directory;;current=path.dirname(current)){
    const entry=lstatSync(current);
    if(!entry.isDirectory()||(entry.mode&0o022)!==0||(current===directory?entry.uid!==uid:entry.uid!==uid&&entry.uid!==0))return false;
    if(path.dirname(current)===current)return true;
  }
}
/** Explicit local compiled-preview path. Any invalid or absent condition is denied. */
export function readLocalDecisionPreviewV7():LocalDecisionPreviewV7|null {
  if(process.env.SAITU_V7_LOCAL_PREVIEW!=="1"||process.env.NODE_ENV!=="production")return null;
  try{
    const uid=process.getuid?.();if(uid===undefined||uid===0)return null;
    // This server gate needs the actual runtime origin, not Next's compiled public value.
    const origin=new URL(String(Reflect.get(process.env,"NEXT_PUBLIC_SITE_URL")??"")),database=new URL(process.env.DATABASE_URL??"");
    if(origin.protocol!=="http:"||!loopbackHosts.has(origin.hostname)||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=="/")return null;
    if(!["postgres:","postgresql:"].includes(database.protocol)||!loopbackHosts.has(database.hostname)||database.search||database.hash||database.port&&database.port!=="5432")return null;
    const databaseName=decodeURIComponent(database.pathname.slice(1));if(!databaseName||databaseName.includes("/"))return null;
    const releaseDirectory=process.env.APP_RELEASE_DIR??"",activeLink=process.env.SAITU_V7_WORKER_ACTIVE_LINK??"";
    if(releaseDirectory.startsWith("/opt/")||releaseDirectory!==realpathSync(process.cwd())||!safeLocalDirectoryV7(releaseDirectory,uid))return null;
    if(!path.isAbsolute(activeLink)||path.resolve(activeLink)!==activeLink||path.basename(activeLink)!=="current"||!safeLocalDirectoryV7(path.dirname(activeLink),uid))return null;
    const link=lstatSync(activeLink);if(!link.isSymbolicLink()||link.uid!==uid||realpathSync(activeLink)!==releaseDirectory)return null;
    const healthFile=path.join(path.dirname(activeLink),"worker-health.json");
    if(process.env.SAITU_V7_WORKER_HEALTH_FILE!==healthFile)return null;
    return {releaseDirectory,activeLink,healthFile,origin:origin.origin};
  }catch{return null;}
}

/** Managed production slots may dispatch only while their release is active. */
export function isActiveDecisionReleaseV7():boolean {
  if(process.env.SAITU_V7_LOCAL_PREVIEW)return readLocalDecisionPreviewV7()!==null;
  const production=process.env.NODE_ENV==="production";
  const release=process.env.APP_RELEASE_DIR;
  const link=production?"/opt/resume-ai/current":process.env.SAITU_V7_WORKER_ACTIVE_LINK;
  if(!link)return !production;
  if(!release||(production&&!/^\/opt\/resume-ai\/releases\/20\d{6}T\d{6}Z$/.test(release)))return false;
  try{
    const entry=lstatSync(link),parent=lstatSync(path.dirname(link));
    return entry.isSymbolicLink()&&(!production||(entry.uid===0&&parent.uid===0&&(parent.mode&0o022)===0))&&realpathSync(link)===realpathSync(release);
  }catch{return false;}
}
