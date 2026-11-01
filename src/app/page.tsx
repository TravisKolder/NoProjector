import Link from "next/link";
import Brand from "@/components/Brand";
import JoinForm from "@/components/JoinForm";

export default function Home() {
  return (
    <main className="page narrow">
      <div className="topbar">
        <Brand />
        <Link href="/decks" className="btn btn-sm">
          Present
        </Link>
      </div>
      <section className="hero stack">
        <h1>Slides on every phone in the room.</h1>
        <p>The presenter advances; everyone follows along on their own screen. Nothing to install.</p>
      </section>
      <div className="card">
        <JoinForm />
      </div>
      <p className="subtle" style={{ marginTop: 16 }}>
        Most people join by scanning the presenter&apos;s QR code with their phone camera.
      </p>
    </main>
  );
}
