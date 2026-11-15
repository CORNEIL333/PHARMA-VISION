import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

class LocationScreen extends StatefulWidget {
  const LocationScreen({super.key});

  @override
  State<LocationScreen> createState() => _LocationScreenState();
}

class _LocationScreenState extends State<LocationScreen> {
  String _selectedCity = 'Yaoundé';
  String _selectedNeighborhood = 'Omnisports';

  final List<String> _cities = ['Yaoundé', 'Douala', 'Bafoussam', 'Garoua', 'Bamenda'];

  final Map<String, List<String>> _neighborhoodsByCity = {
    'Yaoundé': ['Omnisports', 'Bastos', 'Centre-ville', 'Biyem-Assi', 'Mokolo', 'Melen', 'Essos', 'Nlongkak'],
    'Douala': ['Akwa', 'Bonanjo', 'Bonapriso', 'Deido', 'Bali', 'Makepe', 'Bonamoussadi'],
    'Bafoussam': ['Djeleng', 'Tougang', 'Famla', 'Kamkop'],
    'Garoua': ['Plateau', 'Lainde', 'Poumpoumre'],
    'Bamenda': ['Commercial Avenue', 'Up Station', 'Nkwen'],
  };

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final neighborhoods = _neighborhoodsByCity[_selectedCity] ?? [];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Zone géographique'),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Bouton Position GPS
              InkWell(
                onTap: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Position GPS mise à jour : Yaoundé Omnisports')),
                  );
                  Navigator.of(context).pop();
                },
                borderRadius: BorderRadius.circular(16),
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.primary.withOpacity(0.3)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.my_location_rounded, color: AppColors.primary, size: 24),
                      SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Utiliser ma position actuelle',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 15,
                                color: AppColors.primaryDark,
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'Détecter automatiquement via le GPS de l\'appareil',
                              style: TextStyle(fontSize: 12, color: AppColors.primaryDark),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 24),
              const Text(
                'Ou choisir manuellement votre ville',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 12),

              // Sélecteur de ville
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: _cities.map((city) {
                    final isSel = _selectedCity == city;
                    return Padding(
                      padding: const EdgeInsets.only(right: 8.0),
                      child: ChoiceChip(
                        label: Text(city),
                        selected: isSel,
                        onSelected: (val) {
                          if (val) {
                            setState(() {
                              _selectedCity = city;
                              _selectedNeighborhood = _neighborhoodsByCity[city]?.first ?? '';
                            });
                          }
                        },
                        selectedColor: AppColors.primary,
                        labelStyle: TextStyle(
                          color: isSel ? Colors.white : null,
                          fontWeight: isSel ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),

              const SizedBox(height: 20),
              Text(
                'Quartiers disponibles à $_selectedCity',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                ),
              ),
              const SizedBox(height: 10),

              // Liste des quartiers
              Expanded(
                child: ListView.separated(
                  itemCount: neighborhoods.length,
                  separatorBuilder: (context, index) => Divider(
                    height: 1,
                    color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                  ),
                  itemBuilder: (context, index) {
                    final n = neighborhoods[index];
                    final isSelected = _selectedNeighborhood == n;

                    return ListTile(
                      title: Text(
                        n,
                        style: TextStyle(
                          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                          color: isSelected ? AppColors.primary : null,
                        ),
                      ),
                      trailing: isSelected
                          ? const Icon(Icons.check_circle_rounded, color: AppColors.primary)
                          : null,
                      onTap: () {
                        setState(() {
                          _selectedNeighborhood = n;
                        });
                        Navigator.of(context).pop();
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
