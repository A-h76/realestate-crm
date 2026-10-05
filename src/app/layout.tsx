import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/providers/auth-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Synas Labs · Lead-to-Sale CRM",
  description:
    "AI-assisted lead-to-sale CRM for US residential real estate teams: speed to lead, verified follow-up, and a pipeline that reconciles.",
};

const STRIP_INSPECTOR_ATTRS = `(function(){
  var attr="data-cursor-ref";
  var proto=Element.prototype;
  var set=proto.setAttribute;
  proto.setAttribute=function(name,value){
    if(String(name).toLowerCase()===attr)return;
    return set.apply(this,arguments);
  };
  function strip(node){
    if(!node||node.nodeType!==1)return;
    if(node.hasAttribute&&node.hasAttribute(attr))node.removeAttribute(attr);
    var found=node.querySelectorAll?node.querySelectorAll("["+attr+"]"):[];
    for(var i=0;i<found.length;i++)found[i].removeAttribute(attr);
  }
  var observer=new MutationObserver(function(records){
    for(var i=0;i<records.length;i++){
      var record=records[i];
      if(record.type==="attributes"&&record.attributeName===attr){
        record.target.removeAttribute(attr);
      }
      for(var j=0;j<record.addedNodes.length;j++)strip(record.addedNodes[j]);
    }
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:[attr]});
  strip(document.documentElement);
  window.addEventListener("load",function(){
    setTimeout(function(){
      observer.disconnect();
      proto.setAttribute=set;
    },250);
  });
})();`;

// Async on purpose: reading the request headers makes every page render per request, which is what lets Next apply
// the per-request CSP nonce (SEC-010). A statically prerendered page would ship scripts without a nonce and be blocked.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      {process.env.NODE_ENV === "development" ? (
        <head>
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: STRIP_INSPECTOR_ATTRS }} />
        </head>
      ) : null}
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
