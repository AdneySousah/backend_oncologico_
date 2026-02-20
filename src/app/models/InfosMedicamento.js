import Sequelize, { Model } from "sequelize";

class InfosMedicamento extends Model {
    static init(sequelize) {
        super.init({
            possui_medicamento: Sequelize.BOOLEAN,
        }, {
            sequelize,
            tableName: 'infos_medicamentos',
        });
        return this;
    }

    static associate(models) {
        // Associa ao cadastro mestre de medicamentos
        this.belongsTo(models.Medicamentos, { foreignKey: 'medicamento_id', as: 'medicamento_mestre' });
    }
}

export default InfosMedicamento;