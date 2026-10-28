/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";

import { SessionLockStolenView } from "./SessionLockStolenView";

describe("<SessionLockStolenView />", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
    });

    it("takes the session over with one click on Open here", async () => {
        const reload = vi.fn();
        vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload });

        render(<SessionLockStolenView />);
        await userEvent.click(screen.getByRole("button", { name: "Open here" }));

        expect(reload).toHaveBeenCalled();
        expect(SessionLockStolenView.consumeTakeOverRequest()).toBe(true);
        // Consumed once: the next reload asks again as usual.
        expect(SessionLockStolenView.consumeTakeOverRequest()).toBe(false);
    });

    it("does not take over without the request", () => {
        expect(SessionLockStolenView.consumeTakeOverRequest()).toBe(false);
    });
});
