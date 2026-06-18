# PlanAI Field — Android release ProGuard / R8 keep rules
# Copy to: mobile/android/app/proguard-rules.pro

-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
  @com.getcapacitor.annotation.CapacitorPlugin *;
}

# PlanAI custom plugins
-keep class com.piristrategy.planai.** { *; }

# WebView bridge
-keepclassmembers class * {
  @android.webkit.JavascriptInterface <methods>;
}

-dontwarn okhttp3.**
-dontwarn javax.annotation.**
