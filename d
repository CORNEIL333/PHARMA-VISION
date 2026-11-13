[1mdiff --git a/apps/Pharma_connect_flutter/.gitignore b/apps/Pharma_connect_flutter/.gitignore[m
[1mdeleted file mode 100644[m
[1mindex 732c957..0000000[m
[1m--- a/apps/Pharma_connect_flutter/.gitignore[m
[1m+++ /dev/null[m
[36m@@ -1,41 +0,0 @@[m
[31m-# Miscellaneous[m
[31m-*.class[m
[31m-*.log[m
[31m-*.pyc[m
[31m-*.swp[m
[31m-.DS_Store[m
[31m-.atom/[m
[31m-.buildlog/[m
[31m-.history[m
[31m-.svn/[m
[31m-[m
[31m-# IntelliJ / Android Studio[m
[31m-*.iml[m
[31m-*.ipr[m
[31m-*.iws[m
[31m-.idea/[m
[31m-[m
[31m-# VS Code[m
[31m-.vscode/[m
[31m-[m
[31m-# Flutter/Dart/Pub[m
[31m-.dart_tool/[m
[31m-.flutter-plugins[m
[31m-.flutter-plugins-dependencies[m
[31m-.packages[m
[31m-.pub-cache/[m
[31m-.pub/[m
[31m-build/[m
[31m-coverage/[m
[31m-[m
[31m-# Android[m
[31m-/android/app/debug[m
[31m-/android/app/profile[m
[31m-/android/app/release[m
[31m-[m
[31m-# iOS[m
[31m-/ios/Flutter/.last_build_id[m
[31m-/ios/Runner/GeneratedPluginRegistrant.*[m
[31m-[m
[31m-# Web[m
[31m-lib/generated_plugin_registrant.dart[m
[1mdiff --git a/apps/Pharma_connect_flutter/README.md b/apps/Pharma_connect_flutter/README.md[m
[1mdeleted file mode 100644[m
[1mindex 64b0662..0000000[m
[1m--- a/apps/Pharma_connect_flutter/README.md[m
[1m+++ /dev/null[m
[36m@@ -1,18 +0,0 @@[m
[31m-# PharmaConnect Flutter[m
[31m-[m
[31m-Nouveau squelette Flutter de PharmaConnect, créé à côté du gitlink historique `apps/Pharma_connect`.[m
[31m-[m
[31m-## Démarrer[m
[31m-[m
[31m-Avec Flutter installé :[m
[31m-[m
[31m-```sh[m
[31m-flutter pub get[m
[31m-flutter run[m
[31m-```[m
[31m-[m
[31m-Pour générer les projets de plateforme natifs (Android, iOS, etc.) dans ce dossier :[m
[31m-[m
[31m-```sh[m
[31m-flutter create .[m
[31m-```[m
[1mdiff --git a/apps/Pharma_connect_flutter/analysis_options.yaml b/apps/Pharma_connect_flutter/analysis_options.yaml[m
[1mdeleted file mode 100644[m
[1mindex afb106b..0000000[m
[1m--- a/apps/Pharma_connect_flutter/analysis_options.yaml[m
[1m+++ /dev/null[m
[36m@@ -1,5 +0,0 @@[m
[31m-include: package:flutter_lints/flutter.yaml[m
[31m-[m
[31m-linter:[m
[31m-  rules:[m
[31m-    # Add project-specific lint rules here when the app requirements are defined.[m
[1mdiff --git a/apps/Pharma_connect_flutter/lib/main.dart b/apps/Pharma_connect_flutter/lib/main.dart[m
[1mdeleted file mode 100644[m
[1mindex 16b5d58..0000000[m
[1m--- a/apps/Pharma_connect_flutter/lib/main.dart[m
[1m+++ /dev/null[m
[36m@@ -1,33 +0,0 @@[m
[31m-import 'package:flutter/material.dart';[m
[31m-[m
[31m-void main() {[m
[31m-  runApp(const PharmaConnectApp());[m
[31m-}[m
[31m-[m
[31m-class PharmaConnectApp extends StatelessWidget {[m
[31m-  const PharmaConnectApp({super.key});[m
[31m-[m
[31m-  @override[m
[31m-  Widget build(BuildContext context) {[m
[31m-    return MaterialApp([m
[31m-      title: 'PharmaConnect',[m
[31m-      theme: ThemeData([m
[31m-        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF168C80)),[m
[31m-        useMaterial3: true,[m
[31m-      ),[m
[31m-      home: const HomePage(),[m
[31m-    );[m
[31m-  }[m
[31m-}[m
[31m-[m
[31m-class HomePage extends StatelessWidget {[m
[31m-  const HomePage({super.key});[m
[31m-[m
[31m-  @override[m
[31m-  Widget build(BuildContext context) {[m
[31m-    return Scaffold([m
[31m-      appBar: AppBar(title: const Text('PharmaConnect')),[m
[31m-      body: const Center(child: Text('Application initialisée')),[m
[31m-    );[m
[31m-  }[m
[31m-}[m
[1mdiff --git a/apps/Pharma_connect_flutter/pubspec.yaml b/apps/Pharma_connect_flutter/pubspec.yaml[m
[1mdeleted file mode 100644[m
[1mindex 15fbacc..0000000[m
[1m--- a/apps/Pharma_connect_flutter/pubspec.yaml[m
[1m+++ /dev/null[m
[36m@@ -1,20 +0,0 @@[m
[31m-name: pharma_connect[m
[31m-description: Application mobile patient VisionPharma.[m
[31m-publish_to: 'none'[m
[31m-version: 1.0.0+1[m
[31m-[m
[31m-environment:[m
[31m-  sdk: ^3.7.0[m
[31m-[m
[31m-dependencies:[m
[31m-  flutter:[m
[31m-    sdk: flutter[m
[31m-  cupertino_icons: ^1.0.8[m
[31m-[m
[31m-dev_dependencies:[m
[31m-  flutter_test:[m
[31m-    sdk: flutter[m
[31m-  flutter_lints: ^5.0.0[m
[31m-[m
[31m-flutter:[m
[31m-  uses-material-design: true[m
[1mdiff --git a/apps/Pharma_connect_flutter/test/widget_test.dart b/apps/Pharma_connect_flutter/test/widget_test.dart[m
[1mdeleted file mode 100644[m
[1mindex 0e13084..0000000[m
[1m--- a/apps/Pharma_connect_flutter/test/widget_test.dart[m
[1m+++ /dev/null[m
[36m@@ -1,10 +0,0 @@[m
[31m-import 'package:flutter_test/flutter_test.dart';[m
[31m-import 'package:pharma_connect/main.dart';[m
[31m-[m
[31m-void main() {[m
[31m-  testWidgets('affiche l’écran initial', (WidgetTester tester) async {[m
[31m-    await tester.pumpWidget(const PharmaConnectApp());[m
[31m-    expect(find.text('PharmaConnect'), findsWidgets);[m
[31m-    expect(find.text('Application initialisée'), findsOneWidget);[m
[31m-  });[m
[31m-}[m
