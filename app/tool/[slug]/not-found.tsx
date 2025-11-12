import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-800 via-slate-900 to-emerald-950 flex items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-6xl font-bold text-slate-200">404</h1>
        <p className="text-xl text-slate-400">Method not found</p>
        <Link href="/">
          <Button className="bg-orange-500 hover:bg-orange-600 text-white">
            Go Back Home
          </Button>
        </Link>
      </div>
    </div>
  );
}

