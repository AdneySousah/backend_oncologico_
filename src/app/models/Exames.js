import {Model, Sequelize} from 'sequelize';



class Exames extends Model{
    static init(sequelize){
        super.init({
            possui_exame: Sequelize.BOOLEAN,
            nome_exame: Sequelize.STRING,
            tipo_exame: Sequelize.ENUM('sangue', 'imagem', 'biópsia', 'outro'),
            resultado_exame: Sequelize.STRING,
            data_exame_realizado: Sequelize.DATEONLY,
        }, {
            sequelize,
            tableName: 'exames'
        });

        return this;
    }

    static associate(models){
        this.belongsTo(models.PrestadorMedico, { foreignKey: 'prestador_medico_id', as: 'prestador_medico' });
    }
}


export default Exames;