import { redirect } from "next/navigation";
import { authConfigured, currentUserId } from "@/server/auth";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUserId()) redirect("/");
  const configured = authConfigured();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold">PostFlow</h1>
        <p className="mb-6 mt-1 text-sm text-muted">Sign in to your command center.</p>
        {configured ? (
          <LoginForm />
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-medium">Login isn&apos;t configured yet.</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted">
              <li>
                Run <code className="rounded bg-paper px-1">npm run hash-password -- &apos;your password&apos;</code>
              </li>
              <li>
                Put the output in <code className="rounded bg-paper px-1">APP_PASSWORD_HASH</code> in <code>.env</code>
              </li>
              <li>
                Set <code className="rounded bg-paper px-1">SESSION_SECRET</code> (32+ random characters)
              </li>
              <li>Restart the app</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
