import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';
import 'reservation_tracking_screen.dart';

class ReservationFlowScreen extends StatefulWidget {
  final String medicineName;
  final String pharmacyName;
  final int priceXAF;

  const ReservationFlowScreen({
    super.key,
    required this.medicineName,
    required this.pharmacyName,
    required this.priceXAF,
  });

  @override
  State<ReservationFlowScreen> createState() => _ReservationFlowScreenState();
}

class _ReservationFlowScreenState extends State<ReservationFlowScreen> {
  int _quantity = 1;
  String _fulfillmentMethod = 'pickup'; // 'pickup' ou 'delivery'

  void _confirmReservation() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Demande de réservation envoyée'),
        content: Text(
          'Votre demande pour $_quantity boîte(s) de ${widget.medicineName} a été transmise à ${widget.pharmacyName}.\n\nLe pharmacien prépare votre commande et valide la mise de côté.',
        ),
        actions: [
          ElevatedButton(
            onPressed: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (context) => const ReservationTrackingScreen()),
              );
            },
            child: const Text('Suivre ma réservation'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final totalXAF = widget.priceXAF * _quantity;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Demande de réservation'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Récapitulatif produit
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: isDark ? AppColors.darkCard : Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.medicineName,
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Officine : ${widget.pharmacyName}',
                    style: TextStyle(
                      fontSize: 13,
                      color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Prix unitaire : ${widget.priceXAF} XAF',
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      color: AppColors.primary,
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            // Sélecteur de quantité
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Nombre de boîtes',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                ),
                Container(
                  decoration: BoxDecoration(
                    color: isDark ? AppColors.darkCard : AppColors.lightBg,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                    ),
                  ),
                  child: Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.remove_rounded),
                        onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null,
                      ),
                      Text(
                        '$_quantity',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      IconButton(
                        icon: const Icon(Icons.add_rounded),
                        onPressed: _quantity < 5 ? () => setState(() => _quantity++) : null,
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 24),

            // Mode de retrait
            const Text(
              'Mode de récupération',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
            ),
            const SizedBox(height: 10),

            RadioListTile<String>(
              value: 'pickup',
              groupValue: _fulfillmentMethod,
              activeColor: AppColors.primary,
              title: const Text('Retrait au comptoir (Gratuit)'),
              subtitle: const Text('Disponible dès validation par le pharmacien'),
              onChanged: (val) => setState(() => _fulfillmentMethod = val!),
            ),
            RadioListTile<String>(
              value: 'delivery',
              groupValue: _fulfillmentMethod,
              activeColor: AppColors.primary,
              title: const Text('Livraison encadrée par coursier'),
              subtitle: const Text('Colis scellé par l\'officine (Yaoundé intra-muros)'),
              onChanged: (val) => setState(() => _fulfillmentMethod = val!),
            ),

            const SizedBox(height: 24),

            // Récapitulatif total
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: isDark ? AppColors.darkSurface : AppColors.lightBg,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Total estimé à régler'),
                      Text(
                        '$totalXAF XAF',
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primary,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Paiement sur place au retrait ou via Mobile Money agréé après confirmation du pharmacien.',
                    style: TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 32),

            ElevatedButton(
              onPressed: _confirmReservation,
              child: const Text('Valider la demande de mise de côté'),
            ),
          ],
        ),
      ),
    );
  }
}
