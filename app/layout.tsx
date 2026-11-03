import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = {
  title: "ANT ROOM · 지하 관측소",
  description: "개미들이 모여 같은 차트를 보는 지하 관측소",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
