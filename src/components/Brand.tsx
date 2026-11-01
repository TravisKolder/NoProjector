import Link from "next/link";

export default function Brand() {
  return (
    <Link href="/" className="brand" aria-label="No Projector home">
      <span className="brand-mark" aria-hidden="true" />
      No Projector
    </Link>
  );
}
