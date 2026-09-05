# Zero-Node document engine. Kept in parity with portta-core/env by fixtures.
# Inputs travel through ENVIRON so awk does not interpret backslash escapes.
function fail(message) { print message > "/dev/stderr"; failed=1; exit 1 }
function keyof(line, s) {
  s=line; sub(/^[ \t]*(export[ \t]+)?/, "", s)
  if (s !~ /^[A-Za-z_][A-Za-z0-9_]*[ \t]*=/) return ""
  sub(/[ \t]*=.*/, "", s); return s
}
function decode(raw, q, i, c, end, v) {
  q=substr(raw,1,1); valquote=""; valsuffix=""
  if (q=="\047" || q=="\042") {
    valquote=q; v=""; end=0
    for(i=2;i<=length(raw);i++) {
      c=substr(raw,i,1)
      if(c=="\\" && (substr(raw,i+1,1)==q || (q=="\042" && (substr(raw,i+1,1)=="\\" || substr(raw,i+1,1)=="$")))) { v=v substr(raw,++i,1); continue }
      if(c=="\\" && q=="\042" && substr(raw,i+1,1) ~ /^[nrt]$/) {
        c=substr(raw,++i,1); v=v (c=="n" ? "\n" : c=="r" ? "\r" : "\t"); continue
      }
      if(c==q) { end=i; break }
      v=v c
    }
    if(!end) fail("invalid quoted .env value")
    valsuffix=substr(raw,end+1)
    if(valsuffix !~ /^[ \t]*(#.*)?$/) fail("invalid quoted .env value")
    if(q=="\042") { gsub(/\$\$/,"$",v) }
    return v
  }
  if(match(raw,/[ \t]+#/)) { valsuffix=substr(raw,RSTART); return substr(raw,1,RSTART-1) }
  if(match(raw,/[ \t]+$/)) { valsuffix=substr(raw,RSTART); return substr(raw,1,RSTART-1) }
  return raw
}
function valueof(line, s) { s=line; sub(/^[^=]*=[ \t]*/,"",s); return decode(s) }
function encode(v,q, i,c,s) {
  if(v ~ /[\n\r]/) fail("refusing multiline .env value")
  if(index(v,"\\") || q=="\042") {
    s="\042"
    for(i=1;i<=length(v);i++) {
      c=substr(v,i,1)
      if(c=="\\" || c=="\042") s=s "\\"
      if(c=="$") s=s "$"
      s=s c
    }
    return s "\042"
  }
  if(q=="\047" || v ~ /[$ \t#\047\042\\]/) {
    s="\047"
    for(i=1;i<=length(v);i++) { c=substr(v,i,1); if(c=="\047") s=s "\\"; s=s c }
    return s "\047"
  }
  return v
}

function load(path, dest, line,n) {
  n=0
  while((getline line < path)>0) { sub(/\r$/, "", line); dest[++n]=line }
  close(path); return n
}
function indexof(k, i) { for(i=1;i<=n;i++) if(keyof(lines[i])==k) return i; return 0 }
function insert(at,k,v, t,start,j,count) {
  t=ti[k]; start=t
  while(start>1 && !keyof(template[start-1])) start--
  count=t ? t-start+1 : 1
  for(j=n;j>=at;j--) lines[j+count]=lines[j]
  for(j=0;j<count-1;j++) lines[at+j]=template[start+j]
  lines[at+count-1]=k "=" encode(v,""); n+=count
}
function setvalue(k,v, i,j,a,old,prefix,q,suffix,successor,start,t,all,found,x,y) {
  if(k !~ /^[A-Za-z_][A-Za-z0-9_]*$/) fail("invalid .env key")
  if(v ~ /[\n\r]/) fail("refusing multiline .env value")
  i=indexof(k)
  if(i) {
    old=valueof(lines[i]); q=valquote; suffix=valsuffix
    if(old==v) return
    prefix=lines[i]; sub(/=.*/,"=",prefix)
    # Retain spaces immediately following =.
    a=substr(lines[i],length(prefix)+1); match(a,/^[ \t]*/)
    prefix=prefix substr(a,1,RLENGTH)
    lines[i]=prefix encode(v,q) suffix; return
  }
  if(ti[k]) {
    for(j=ti[k]-1;j>=1;j--) if((a=keyof(template[j])) && (i=indexof(a))) { insert(i+1,k,v); return }
    for(j=ti[k]+1;j<=tn;j++) if((a=keyof(template[j])) && (i=indexof(a))) {
      successor=i
      while(i>1 && !keyof(lines[i-1])) i--
      t=ti[k]; start=t
      while(start>1 && !keyof(template[start-1])) start--
      all=(start<t)
      for(x=start;x<t;x++) if(template[x]!="") {
        found=0; for(y=i;y<successor;y++) if(lines[y]==template[x]) found=1
        if(!found) all=0
      }
      if(all) {
        for(x=n;x>=successor;x--) lines[x+1]=lines[x]
        lines[successor]=k "=" encode(v,""); n++
      } else insert(i,k,v)
      return
    }
  }
  insert(n+1,k,v); finalnl=1
}
BEGIN {
  file=ENVIRON["PORTTA_ENV_PATH"]; mode=ENVIRON["PORTTA_ENV_OPERATION"]
  tn=load(ENVIRON["PORTTA_ENV_TEMPLATE"],template)
  for(i=1;i<=tn;i++) {
    k=keyof(template[i]); if(k) { if(ti[k]) fail("duplicate template key: " k); ti[k]=i; defaults[k]=valueof(template[i]) }
    else comments[template[i]]=1
  }
  n=load(file,lines); finalnl=ENVIRON["PORTTA_ENV_FINAL_NL"]!="false"; eol=ENVIRON["PORTTA_ENV_CRLF"]=="true" ? "\r\n" : "\n"
  for(i=1;i<=n;i++) {
    k=keyof(lines[i]); if(k) { if(k in values) fail("duplicate .env key: " k); values[k]=valueof(lines[i]); suffixes[k]=valsuffix }
    if(lines[i]=="# Portta environment structure: 1") structured=1
  }
  if(mode=="get") { printf "%s", values[ENVIRON["PORTTA_ENV_KEY"]]; exit }
  if(mode=="read") {
    for(i=1;i<=n;i++) if((k=keyof(lines[i]))) {
      if(values[k] ~ /[\n\r]/) fail("refusing multiline .env value")
      printf "%s\t%s\n",k,values[k]
    }
    exit
  }
  if(mode=="prepare") {
    if(!tn) fail("missing .env.example for this installation")
    if(!structured) {
      retired["PORTTA_WEB_DEV_PORT"]=1; retired["PORTTA_WEB_AUTH"]=1; retired["PORTTA_WEB_AUTH_USER"]=1; retired["PORTTA_WEB_AUTH_HASH"]=1
      for(i=1;i<=n;i++) {
        k=keyof(lines[i])
        if(k ? (!ti[k] && !retired[k]) : (lines[i]!="" && !comments[lines[i]])) extra[++en]=lines[i]
      }
      n=tn; for(i=1;i<=tn;i++) lines[i]=template[i]
      for(k in values) if(ti[k]) setvalue(k,values[k])
      for(i=1;i<=n;i++) if((k=keyof(lines[i])) && index(suffixes[k],"#")) lines[i]=lines[i] suffixes[k]
      if(en) { lines[++n]=""; lines[++n]="# Preserved installation extensions and comments"; for(i=1;i<=en;i++) lines[++n]=extra[i] }
      finalnl=1; eol="\n"
    } else for(i=1;i<=tn;i++) if((k=keyof(template[i])) && !(k in values)) setvalue(k,defaults[k])
  }
  if(mode=="set" || (mode=="ensure" && values[ENVIRON["PORTTA_ENV_KEY"]]=="")) {
    if(!n && tn) { n=tn; for(i=1;i<=tn;i++) lines[i]=template[i] }
    setvalue(ENVIRON["PORTTA_ENV_KEY"],ENVIRON["PORTTA_ENV_VALUE"])
  }
  for(i=1;i<=n;i++) printf "%s%s",lines[i],(i<n || finalnl ? eol : "")
}
