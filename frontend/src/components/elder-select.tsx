"use client";

import { useEffect, useMemo, useState } from "react";

import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Elder } from "@/lib/types";

export function useElderList() {
  const { session } = useAuth();
  const [elders, setElders] = useState<Elder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setLoading(true);
    api
      .get<Elder[]>("/api/v1/elders", controller.signal)
      .then((data) => {
        setElders(data);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "加载老人列表失败");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [session]);

  return { elders, loading, error };
}

export function ElderSelect({
  value,
  onChange,
  allowAll = false,
  allLabel = "全部老人",
  placeholder = "请选择老人",
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const { elders, loading, error } = useElderList();

  const options = useMemo(() => {
    const list = elders.map((elder) => ({
      value: String(elder.id),
      label: elder.name,
    }));
    if (allowAll) {
      return [{ value: "", label: allLabel }, ...list];
    }
    return list;
  }, [elders, allowAll, allLabel]);

  const placeholderText = error
    ? "老人列表加载失败"
    : loading
      ? "加载中…"
      : options.length === 0
        ? "暂无可见老人"
        : placeholder;

  return (
    <Select
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholderText}
      className={className}
      disabled={loading || Boolean(error) || options.length === 0}
      aria-label={ariaLabel}
    />
  );
}
