import Link from "next/link";
export default function NotFound() {
  return (
    <>
      <h1 style={{ marginTop: 40 }}>Not on the menu</h1>
      <p className="lede">That page doesn&apos;t exist. Try the <Link href="/library">library</Link>.</p>
    </>
  );
}
