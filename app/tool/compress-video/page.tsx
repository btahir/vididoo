import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CompressVideoTool } from "./compress-video-tool";
import { FileDown } from "lucide-react";

export default function CompressVideoPage() {
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-800 via-slate-900 to-emerald-950">
      <main className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Back Button */}
        <div className="mb-8">
          <Link href="/">
            <Button
              variant="ghost"
              className="text-slate-300 hover:text-orange-400 hover:bg-slate-800/50"
            >
              ← Back to Home
            </Button>
          </Link>
        </div>

        <div className="max-w-4xl mx-auto">
          <Card className="border-slate-700/50 bg-slate-800/40 shadow-lg shadow-slate-900/20 backdrop-blur-sm">
            <CardHeader className="text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center text-slate-300">
                <FileDown className="h-11 w-11" strokeWidth={1.4} />
              </div>
              <CardTitle className="text-4xl font-bold text-slate-200">
                Compress Video
              </CardTitle>
              <CardDescription className="text-lg text-slate-400 mt-2">
                Reduce video file size while maintaining quality. Choose from preset quality levels or set custom bitrates.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <CompressVideoTool />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}