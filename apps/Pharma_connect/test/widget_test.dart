import 'package:flutter_test/flutter_test.dart';
import 'package:pharma_connect/main.dart';

void main() {
  testWidgets('Vérification du chargement initial de PharmaConnect', (WidgetTester tester) async {
    await tester.pumpWidget(const PharmaConnectApp());
    await tester.pump();

    // Vérifie la présence des éléments clés de la marque
    expect(find.text('PHARMACONNECT'), findsOneWidget);
    expect(find.text('Démarrer l\'expérience'), findsOneWidget);
  });
}
