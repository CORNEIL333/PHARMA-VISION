import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../medicine/medicine_detail_screen.dart';
import '../prescription/prescription_upload_screen.dart';

class PharmacyDetailScreen extends StatelessWidget {
  final String name;
  final String neighborhood;
  final String distance;
  final bool isGuard;
  final String? phone;

  const PharmacyDetailScreen({
    super.key,
    required this.name,
    required this.neighborhood,
    required this.distance,
    required this.isGuard,
    this.phone,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: Text(name),
        actions: [
          IconButton(
            icon: const Icon(Icons.share_outlined),
            tooltip: 'Partager l\'officine',
            onPressed: () {},
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(18.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Carte principale de l'officine
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: isDark ? AppColors.darkCard : Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          name,
                          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                      ),
                      if (isGuard)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: const Color(0xFF6366F1).withOpacity(0.12),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.nightlight_round, size: 14, color: Color(0xFF6366F1)),
                              SizedBox(width: 4),
                              Text(
                                'De garde (24h/24)',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF6366F1),
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.location_on_outlined, size: 16, color: AppColors.primary),
                      const SizedBox(width: 6),
                      Text(
                        '$neighborhood • $distance',
                        style: TextStyle(
                          fontSize: 14,
                          color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      const Icon(Icons.access_time_rounded, size: 16, color: AppColors.primary),
                      const SizedBox(width: 6),
                      Text(
                        isGuard ? 'Ouvert en continu (Garde)' : 'Ouvert de 07h30 à 21h30',
                        style: TextStyle(
                          fontSize: 14,
                          color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Actions rapides (Appeler, Itinéraire, Ordonnance)
                  Row(
                    children: [
                      if (phone != null && phone!.isNotEmpty) ...[
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text('Composition de $phone...')),
                              );
                            },
                            icon: const Icon(Icons.call_rounded, size: 18),
                            label: const Text('Appeler'),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                      ],
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (context) => const PrescriptionUploadScreen(),
                              ),
                            );
                          },
                          icon: const Icon(Icons.document_scanner_rounded, size: 18),
                          label: const Text('Ordonnance'),
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            // Avertissement de fraîcheur & légal
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF162521) : const Color(0xFFF0FDF4),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.accent.withOpacity(0.3)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.info_outline_rounded, color: AppColors.accent, size: 20),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Données synchronisées avec le serveur local VisionPharma de l\'officine il y a 8 min. Toute réservation est soumise à validation pharmaceutique.',
                      style: TextStyle(fontSize: 12, height: 1.4),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            const Text(
              'Médicaments fréquemment demandés',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),

            _buildMedicineTile(
              context,
              name: 'Doliprane 500mg',
              form: 'Boîte de 16 comprimés',
              priceXAF: 1250,
              available: true,
            ),
            _buildMedicineTile(
              context,
              name: 'Amoxicilline 500mg',
              form: 'Boîte de 12 gélules (Sur ordonnance)',
              priceXAF: 2100,
              available: true,
            ),
            _buildMedicineTile(
              context,
              name: 'Artesunate + Amodiaquine',
              form: 'Traitement antipaludique adulte',
              priceXAF: 1800,
              available: true,
            ),
            _buildMedicineTile(
              context,
              name: 'Sérum Physiologique 0.9%',
              form: 'Pack de 10 unidoses 5ml',
              priceXAF: 900,
              available: true,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMedicineTile(
    BuildContext context, {
    required String name,
    required String form,
    required int priceXAF,
    required bool available,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        title: Text(name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 3),
            Text(
              form,
              style: TextStyle(
                fontSize: 12,
                color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              available ? 'En stock' : 'Rupture',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.bold,
                color: available ? AppColors.statusAvailable : AppColors.statusExpired,
              ),
            ),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '$priceXAF XAF',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 15,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 4),
            const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: AppColors.primary),
          ],
        ),
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (context) => MedicineDetailScreen(
                medicineName: name,
                pharmacyName: this.name,
                priceXAF: priceXAF,
              ),
            ),
          );
        },
      ),
    );
  }
}
