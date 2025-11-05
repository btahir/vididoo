import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { METHODS } from "@/lib/constants";

export default function Home() {
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-800 via-slate-900 to-emerald-950">
      <main className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="text-center mb-16">
          <h1 className="text-6xl sm:text-7xl font-bold mb-4 bg-linear-to-r from-orange-400 via-orange-500 to-orange-600 bg-clip-text text-transparent">
            Vididoo
          </h1>
          <p className="text-xl sm:text-2xl text-slate-300 font-medium">
            The simplest way to edit your media files.
          </p>
        </header>

        {/* Methods Grid */}
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {METHODS.map((method) => {
              const Icon = method.icon;

              return (
                <Link key={method.slug} href={`/method/${method.slug}`}>
                  <Card className="group relative h-full cursor-pointer border-slate-700/50 bg-slate-800/50 backdrop-blur-sm py-0 transition-all duration-200 hover:border-slate-500/50 hover:shadow-lg hover:shadow-slate-900/20 hover:-translate-y-1">
                    <CardContent className="flex flex-col items-center justify-center p-6 text-center space-y-4">
                      <div className="flex h-14 w-14 items-center justify-center text-slate-300 transition-colors duration-200 group-hover:text-slate-100">
                        <Icon className="h-6 w-6" strokeWidth={1.4} />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-200 transition-colors group-hover:text-slate-50">
                        {method.name}
                      </h3>
                    </CardContent>
                    <div className="absolute inset-0 rounded-xl border border-transparent transition-colors duration-200 pointer-events-none group-hover:border-slate-500/40" />
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
