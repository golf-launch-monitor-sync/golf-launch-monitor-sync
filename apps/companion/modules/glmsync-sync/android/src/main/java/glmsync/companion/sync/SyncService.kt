// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
package glmsync.companion.sync

import android.content.Intent
import android.os.Binder
import android.os.IBinder
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Fetching without a visible switch (spec/deep-links.md, "Android"). A target app binds to this service
 * while it is in front: a service a foreground app is bound to counts as foreground, so this app may run
 * its sync now - a plain startService from another app would be refused since Android 8.
 *
 * Every bind (and rebind) starts the headless JavaScript task `glmsync-nudge` with the intent's data and
 * its reason, as they came; src/lib/nudge.ts reads them strictly and syncs only a paired target, its
 * plan first. Nothing comes back over the binder: the target sees the result in its own import.
 *
 * The JavaScript runs in the app's one runtime (the screen's, when it is open), so the sync joins the
 * same queue as the screen and the background task. When the target lets go (at most two minutes),
 * the service ends and so does its wake lock.
 */
class SyncService : HeadlessJsTaskService() {
    private val binder = Binder()

    override fun onBind(intent: Intent): IBinder {
        nudge(intent)
        return binder
    }

    override fun onRebind(intent: Intent?) {
        super.onRebind(intent)
        nudge(intent)
    }

    // true: the next binding after all have let go comes to onRebind, which starts a sync too.
    override fun onUnbind(intent: Intent?): Boolean = true

    // The service is for binding only; a start (from anywhere) does nothing.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        stopSelf(startId)
        return START_NOT_STICKY
    }

    private fun nudge(intent: Intent?) {
        try {
            val link = intent?.dataString?.takeIf { it.length <= MAX_LINK } ?: return
            // Another app's extras: reading them may throw (a bad parcel), hence inside the try.
            val reason = intent.getStringExtra(EXTRA_REASON)?.takeIf { it.length <= MAX_REASON }
            val data = Arguments.createMap().apply {
                putString("link", link)
                if (reason != null) putString("reason", reason) else putNull("reason")
            }
            startTask(HeadlessJsTaskConfig(TASK, data, TIMEOUT_MS, true))
        } catch (e: Exception) {
            // A binding must never crash the app; the target sees no import and may ask again.
            Log.w(TAG, "The sync could not start", e)
        }
    }

    companion object {
        const val ACTION = "glmsync.intent.action.SYNC"
        const val EXTRA_REASON = "glmsync.extra.REASON"
        /** src/lib/nudge.ts NUDGE_TASK. */
        const val TASK = "glmsync-nudge"
        /** src/lib/nudge.ts NUDGE_TIMEOUT_MS: a target holds the binding at most two minutes. */
        const val TIMEOUT_MS = 120_000L
        /** A link longer than a link may be (spec) isn't passed on at all. */
        const val MAX_LINK = 2048
        const val MAX_REASON = 32
        private const val TAG = "GlmsyncSync"
    }
}
