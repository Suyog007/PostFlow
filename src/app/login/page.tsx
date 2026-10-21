import { LoginForm } from "./form";
import { Logo } from "@/components/ui";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[340px]">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo size={28} />
          <span className="text-[18px] font-semibold tracking-tight">PostFlow</span>
        </div>
        <div className="panel p-5">
          <h1 className="mb-1 text-[15px] font-semibold">Sign in</h1>
          <p className="mb-4 text-[13px] text-[var(--muted)]">Your LinkedIn and X posting desk.</p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
