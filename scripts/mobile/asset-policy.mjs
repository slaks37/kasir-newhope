// Vite's content hash can end with SW; that is not a service-worker entry.
export function forbiddenMerchantAsset(file){
 return /admin|landing|\.map$|\.env/i.test(file)||/(?:^|[/\\])sw(?:-[\w-]+)?\.js$/i.test(file);
}
