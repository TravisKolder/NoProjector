import Link from "next/link";
import Brand from "@/components/Brand";
import JoinForm from "@/components/JoinForm";
import PhonesIllustration from "@/components/PhonesIllustration";

export default function Home() {
  return (
    <main className="page narrow">
      <div className="topbar">
        <Brand />
        <Link href="/decks" className="btn btn-sm">
          Start presenting
        </Link>
      </div>
      <section className="hero stack">
        <h1>Slides on every phone in the room.</h1>
        <p>The presenter advances; everyone follows along on their own screen. Nothing to install.</p>
      </section>
      <PhonesIllustration className="hero-art" />
      <div className="card">
        <JoinForm />
      </div>
      <p className="subtle" style={{ marginTop: 16 }}>
        Most people join by scanning the presenter&apos;s QR code with their phone camera.
      </p>
      <section className="how" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol>
          <li>
            <span><strong>Make a deck.</strong> Type slides, or import a PDF or PowerPoint.</span>
          </li>
          <li>
            <span><strong>Show the QR code.</strong> Start a session and hold up your screen.</span>
          </li>
          <li>
            <span><strong>Everyone follows on their phone.</strong> When you advance, every phone moves with you.</span>
          </li>
        </ol>
      </section>
    </main>
  );
}
