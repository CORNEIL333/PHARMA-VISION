import 'package:flutter_test/flutter_test.dart';
import 'package:pharma_connect/main.dart';

void main() {
  testWidgets('affiche l’écran initial', (WidgetTester tester) async {
    await tester.pumpWidget(const PharmaConnectApp());
    expect(find.text('PharmaConnect'), findsWidgets);
    expect(find.text('Application initialisée'), findsOneWidget);
  });
}
