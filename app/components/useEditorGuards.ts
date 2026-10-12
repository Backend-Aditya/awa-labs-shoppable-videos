// Shared behaviour for every page with a save bar (widget editor, reel
// editor, settings):
// - Ctrl/Cmd+S saves, like every other editor merchants use.
// - Leaving with unsaved changes through in-app navigation (breadcrumbs,
//   links, list rows) asks first, using App Bridge's own confirmation so it
//   matches the admin's native "leave page?" behaviour. The admin nav is
//   already guarded by the save bar itself.
import { useEffect, useRef } from "react";
import { useBlocker, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

export function useEditorGuards({ dirty, onSave }: { dirty: boolean; onSave: () => void }) {
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const bypass = useRef(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !bypass.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const target = `${blocker.location.pathname}${blocker.location.search}`;
    blocker.reset();
    const confirm = shopify.saveBar?.leaveConfirmation?.();
    Promise.resolve(confirm).then(() => {
      bypass.current = true;
      navigate(target);
    });
  }, [blocker, navigate, shopify]);

  // A fresh page (e.g. after duplicating) starts unguarded again.
  useEffect(() => {
    if (!dirty) bypass.current = false;
  }, [dirty]);
}
