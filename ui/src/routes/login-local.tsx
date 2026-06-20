import { ActionFunctionArgs, Form, redirect, useActionData } from "react-router-dom";
import { useState, useEffect } from "react";
import { LuEye, LuEyeOff } from "react-icons/lu";

import SimpleNavbar from "@components/SimpleNavbar";
import Container from "@components/Container";
import Fieldset from "@components/Fieldset";
import { InputFieldWithLabel } from "@components/InputField";
import { Button } from "@components/Button";
import LogoLuckfox from "@/assets/logo-luckfox.png";
import { DEVICE_API } from "@/ui.config";
import { DeviceStatus } from "@routes/login_page/index";

import api from "../api";
import ExtLink from "../components/ExtLink";


const loader = async () => {
  const res = await api
    .GET(`${DEVICE_API}/device/status`)
    .then(res => res.json() as Promise<DeviceStatus>);

  if (!res.isSetup) return redirect("/mode");

  const deviceRes = await api.GET(`${DEVICE_API}/device`);
  if (deviceRes.ok) return redirect("/");
  return null;
};

const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const password = formData.get("password");

  try {
    const response = await api.POST(`${DEVICE_API}/auth/login-local`, {
      password,
    });

    if (response.ok) {
      return redirect("/");
    } else {
      const data = await response.json();
      return { error: data.error || "Invalid password" };
    }
  } catch (error) {
    console.error(error);
    return { error: "An error occurred while logging in" };
  }
};

interface BannedIP {
  ip: string;
  bannedAt: string;
}

// 被封禁 IP 列表：公开拉取（无需登录），每 5 秒刷新。
// 封禁规则见后端 ratelimit.go：同一 IP 密码失败 2 次即永久封禁（重启清空）。
function BannedList() {
  const [banned, setBanned] = useState<BannedIP[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .GET(`${DEVICE_API}/auth/banned`)
        .then(res => (res.ok ? res.json() : { banned: [] }))
        .then(data => {
          if (alive) setBanned(data.banned ?? []);
        })
        .catch(() => {
          /* 登录页静默失败即可 */
        });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const fmtTime = (s: string) => {
    const d = new Date(s);
    return isNaN(d.getTime())
      ? s
      : d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  };

  return (
    <div className="mx-auto max-w-sm text-xs text-slate-500 dark:text-[#ffffff]">
      <div className="mb-1 font-medium">Banned IPs</div>
      {banned.length === 0 ? (
        <div className="text-slate-400">None</div>
      ) : (
        <ul className="space-y-1">
          {banned.map(b => (
            <li key={b.ip} className="flex justify-between gap-3">
              <span className="font-mono">{b.ip}</span>
              <span className="whitespace-nowrap">{fmtTime(b.bannedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LoginLocalRoute() {
  const actionData = useActionData() as { error?: string; success?: boolean };
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      <div className="grid min-h-screen grid-rows-(--grid-layout)">
        <SimpleNavbar />
        <Container>
          <div className="flex h-full w-full items-center justify-center">
            <div className="-mt-32 max-w-2xl space-y-8">
              <div className="flex items-center justify-center">
                <img
                  src={LogoLuckfox}
                  alt=""
                  className="-ml-4 hidden h-[32px] dark:block"
                />
                <img src={LogoLuckfox} alt="" className="-ml-4 h-[32px] dark:hidden" />
              </div>

              <div className="space-y-2 text-center">
                <h1 className="text-4xl font-semibold text-black dark:text-white">
                  Welcome back to KVM
                </h1>
                <p className="font-medium text-slate-600 dark:text-[#ffffff]">
                  Enter your password to access your KVM.
                </p>
              </div>

              <Fieldset className="space-y-12">
                <Form method="POST" className="mx-auto max-w-sm space-y-4">
                  <div className="space-y-4">
                    <InputFieldWithLabel
                      label="Password"
                      type={showPassword ? "text" : "password"}
                      name="password"
                      placeholder="Enter your password"
                      autoFocus
                      error={actionData?.error}
                      TrailingElm={
                        showPassword ? (
                          <div
                            onClick={() => setShowPassword(false)}
                            className="pointer-events-auto"
                          >
                            <LuEye className="h-4 w-4 cursor-pointer text-slate-500 dark:text-[#ffffff]" />
                          </div>
                        ) : (
                          <div
                            onClick={() => setShowPassword(true)}
                            className="pointer-events-auto"
                          >
                            <LuEyeOff className="h-4 w-4 cursor-pointer text-slate-500 dark:text-[#ffffff]" />
                          </div>
                        )
                      }
                    />
                  </div>

                  <Button
                    size="LG"
                    theme="primary"
                    fullWidth
                    type="submit"
                    text="Log In"
                    textAlign="center"
                  />

                  <div className="mt-4 flex justify-start text-xs text-slate-500 dark:text-[#ffffff]">
                    <ExtLink
                      href="https://wiki.luckfox.com/intro"
                      className="hover:underline"
                    >
                      Forgot password?
                    </ExtLink>
                  </div>
                </Form>
              </Fieldset>

              <BannedList />
            </div>
          </div>
        </Container>
      </div>
    </>
  );
}

LoginLocalRoute.loader = loader;
LoginLocalRoute.action = action;
