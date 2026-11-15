import 'package:flutter/material.dart';

class AppColors {
  // Brand & Accent
  static const Color primary = Color(0xFF168C80);
  static const Color primaryDark = Color(0xFF1B4D3E);
  static const Color primaryLight = Color(0xFFE6F4F1);
  static const Color accent = Color(0xFF10B981);

  // Light Theme Surfaces
  static const Color lightBg = Color(0xFFF8FAFC);
  static const Color lightSurface = Colors.white;
  static const Color lightBorder = Color(0xFFE2E8F0);
  static const Color lightTextPrimary = Color(0xFF0F172A);
  static const Color lightTextSecondary = Color(0xFF64748B);
  static const Color lightTextMuted = Color(0xFF94A3B8);

  // Dark Theme Surfaces
  static const Color darkBg = Color(0xFF0C1412);
  static const Color darkSurface = Color(0xFF15221F);
  static const Color darkCard = Color(0xFF1A2A26);
  static const Color darkBorder = Color(0xFF263D37);
  static const Color darkTextPrimary = Color(0xFFF8FAFC);
  static const Color darkTextSecondary = Color(0xFF94A3B8);
  static const Color darkTextMuted = Color(0xFF64748B);

  // Freshness & Status Badges (conformes aux spécifications produit)
  static const Color statusAvailable = Color(0xFF10B981);       // < 1h : Disponible
  static const Color statusToConfirm = Color(0xFFF59E0B);       // 1-24h : À confirmer
  static const Color statusExpired = Color(0xFFEF4444);         // > 24h : Stock expiré
  static const Color statusInfo = Color(0xFF3B82F6);            // Information / Garde
}
