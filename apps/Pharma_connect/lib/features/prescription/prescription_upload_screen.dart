import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import '../reservation/reservation_tracking_screen.dart';

class PrescriptionUploadScreen extends StatefulWidget {
  final String? preselectedPharmacy;

  const PrescriptionUploadScreen({super.key, this.preselectedPharmacy});

  @override
  State<PrescriptionUploadScreen> createState() => _PrescriptionUploadScreenState();
}

class _PrescriptionUploadScreenState extends State<PrescriptionUploadScreen> {
  bool _hasImage = true; // Simulé pour l'aperçu graphique
  String _selectedPharmacy = 'Pharmacie du Soleil (Omnisports)';
  final TextEditingController _notesController = TextEditingController();

  final List<String> _pharmacies = [
    'Pharmacie du Soleil (Omnisports)',
    'Pharmacie Mfoundi Centre (Centre-ville)',
    'Grande Pharmacie Bastos (Bastos)',
  ];

  @override
  void initState() {
    super.initState();
    if (widget.preselectedPharmacy != null) {
      _selectedPharmacy = widget.preselectedPharmacy!;
    }
  }

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  void _submitPrescription() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.check_circle_rounded, color: AppColors.primary),
            SizedBox(width: 8),
            Text('Ordonnance envoyée'),
          ],
        ),
        content: const Text(
          'Votre ordonnance a été transmise en toute confidentialité à l\'officine sélectionnée. Le pharmacien va analyser la prescription et préparer votre demande.',
        ),
        actions: [
          ElevatedButton(
            onPressed: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (context) => const ReservationTrackingScreen()),
              );
            },
            child: const Text('Suivre la demande'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Transmettre une ordonnance'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Zone de prise / aperçu photo
            Container(
              height: 240,
              decoration: BoxDecoration(
                color: isDark ? AppColors.darkCard : const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                  width: 2,
                ),
              ),
              child: _hasImage
                  ? Stack(
                      children: [
                        Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Container(
                                padding: const EdgeInsets.all(16),
                                decoration: BoxDecoration(
                                  color: AppColors.primaryLight,
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(
                                  Icons.document_scanner_rounded,
                                  size: 48,
                                  color: AppColors.primary,
                                ),
                              ),
                              const SizedBox(height: 12),
                              const Text(
                                'Ordonnance_Dr_Kamdem.jpg',
                                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Photo capturée (Qualité nette et lisible)',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Positioned(
                          top: 12,
                          right: 12,
                          child: Row(
                            children: [
                              IconButton.filledTonal(
                                onPressed: () {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Reprise de la photo...')),
                                  );
                                },
                                icon: const Icon(Icons.refresh_rounded, size: 20),
                                tooltip: 'Remplacer la photo',
                              ),
                              const SizedBox(width: 8),
                              IconButton.filledTonal(
                                onPressed: () {
                                  setState(() => _hasImage = false);
                                },
                                icon: const Icon(Icons.delete_outline_rounded, size: 20),
                                tooltip: 'Supprimer',
                              ),
                            ],
                          ),
                        ),
                      ],
                    )
                  : Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.camera_alt_outlined, size: 48, color: AppColors.primary),
                          const SizedBox(height: 12),
                          ElevatedButton.icon(
                            onPressed: () => setState(() => _hasImage = true),
                            icon: const Icon(Icons.add_a_photo_rounded, size: 18),
                            label: const Text('Prendre en photo l\'ordonnance'),
                            style: ElevatedButton.styleFrom(
                              minimumSize: Size.zero,
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                            ),
                          ),
                        ],
                      ),
                    ),
            ),

            const SizedBox(height: 24),

            // Sélection de l'officine
            const Text(
              'Pharmacie destinataire',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              value: _selectedPharmacy,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.storefront_rounded, color: AppColors.primary),
              ),
              items: _pharmacies.map((p) {
                return DropdownMenuItem(value: p, child: Text(p));
              }).toList(),
              onChanged: (val) {
                if (val != null) {
                  setState(() => _selectedPharmacy = val);
                }
              },
            ),

            const SizedBox(height: 20),

            // Notes complémentaires
            const Text(
              'Précisions pour le pharmacien (facultatif)',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: _notesController,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'Ex : allergies connues, préférence pour les comprimés ou génériques équivalents...',
              ),
            ),

            const SizedBox(height: 24),

            // Rappel éthique et légal
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: isDark ? AppColors.darkCard : const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                ),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.lock_outline_rounded, size: 20, color: AppColors.primary),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Confidentialité garantie : seul le pharmacien de l\'officine sélectionnée aura accès à ce document. Lors du retrait en pharmacie, l\'original papier de l\'ordonnance devra obligatoirement être présenté.',
                      style: TextStyle(fontSize: 12, height: 1.45),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 32),

            ElevatedButton(
              onPressed: _hasImage ? _submitPrescription : null,
              child: const Text('Transmettre pour analyse pharmaceutique'),
            ),
          ],
        ),
      ),
    );
  }
}
